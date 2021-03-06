/* Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to you under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Config, DQ, XMLQuery} from "../../ext/monadish";
import {ResponseProcessor} from "./ResponseProcessor";

import {IResponseProcessor} from "./IResponseProcessor";
import {
    CMD_ATTRIBUTES,
    CMD_CHANGES,
    CMD_DELETE,
    CMD_ERROR,
    CMD_EVAL,
    CMD_EXTENSION,
    CMD_INSERT,
    CMD_REDIRECT,
    CMD_UPDATE,
    P_VIEWBODY,
    P_VIEWHEAD,
    P_VIEWROOT,
    PARTIAL_ID,
    RESP_PARTIAL,
    RESPONSE_XML,
    TAG_AFTER,
    TAG_BEFORE
} from "../core/Const";
import {resolveContexts, resolveResponseXML} from "./ResonseDataResolver";


export module Response {


    /**
     * Standardized jsf.js response
     * this one is called straight from jsf.js.response
     *
     * The processing follows the spec by going for the responseXML
     * and processing its tags
     *
     * @param {XMLHttpRequest} request (xhrRequest) - xhr request object
     * @param {[key: string]: any} context (Map) - AJAX context
     *
     */
    export function processResponse(request: XMLHttpRequest, context: { [key: string]: any }) {

        let req = Config.fromNullable(request);
        let {externalContext, internalContext} = resolveContexts(context);
        let responseXML: XMLQuery = resolveResponseXML(req);
        let responseProcessor = new ResponseProcessor(req, externalContext, internalContext);

        internalContext.assign(RESPONSE_XML).value = responseXML;

        //we now process the partial tags, or in none given raise an error
        responseXML.querySelectorAll(RESP_PARTIAL)
            .each(item => processPartialTag(<XMLQuery>item, responseProcessor, internalContext));

        //we now process the viewstates and the evals deferred
        //the reason for this is that often it is better
        //to wait until the document has caught up before
        //doing any evals even on embedded scripts
        responseProcessor.fixViewStates();
        responseProcessor.globalEval();

        responseProcessor.done();
    }

    /**
     * highest node partial-response from there the main operations are triggered
     */
     function processPartialTag(node: XMLQuery, responseProcessor: IResponseProcessor, internalContext) {

        internalContext.assign(PARTIAL_ID).value = node.id;
        const SEL_SUB_TAGS = [CMD_ERROR, CMD_REDIRECT, CMD_CHANGES].join(",");

        //now we can process the main operations
        node.getIf(SEL_SUB_TAGS).each((node: XMLQuery) => {
            switch (node.tagName.value) {
                case CMD_ERROR:
                    responseProcessor.error(node);
                    break;
                case CMD_REDIRECT:
                    responseProcessor.redirect(node);
                    break;
                case CMD_CHANGES:
                    processChangesTag(node, responseProcessor);
                    break;
            }
        });

    }

    let processInsert = function (responseProcessor: IResponseProcessor, node: XMLQuery) {
         //path1 insert after as child tags
         if(node.querySelectorAll([TAG_BEFORE, TAG_AFTER].join(",")).length) {
             responseProcessor.insertWithSubtags(node);
         } else { //insert before after with id
             responseProcessor.insert(node);
         }

    };

    /**
     * next level changes tag
     *
     * @param node
     * @param responseProcessor
     */
     function processChangesTag(node: XMLQuery, responseProcessor: IResponseProcessor): boolean {
        const ALLOWED_TAGS = [CMD_UPDATE, CMD_EVAL, CMD_INSERT, CMD_DELETE, CMD_ATTRIBUTES, CMD_EXTENSION].join(",");
        node.getIf(ALLOWED_TAGS).each(
            (node: XMLQuery) => {
                switch (node.tagName.value) {
                    case CMD_UPDATE:
                        processUpdateTag(node, responseProcessor);
                        break;

                    case CMD_EVAL:
                        responseProcessor.eval(node);
                        break;

                    case CMD_INSERT:
                        processInsert(responseProcessor, node);
                        break;

                    case CMD_DELETE:
                        responseProcessor.delete(node);
                        break;

                    case CMD_ATTRIBUTES:
                        responseProcessor.attributes(node);
                        break;

                    case CMD_EXTENSION:
                        break;
                }
            }
        );
        return true;
    }

    /**
     * branch tag update.. drill further down into the updates
     * special case viewstate in that case it is a leaf
     * and the viewstate must be processed
     *
     * @param node
     * @param responseProcessor
     */
     function processUpdateTag(node: XMLQuery, responseProcessor: IResponseProcessor) {
        if (!responseProcessor.processViewState(node)) {
            handleElementUpdate(node, responseProcessor);
        }
    }

    /**
     * element update
     *
     * @param node
     * @param responseProcessor
     */
     function handleElementUpdate(node: XMLQuery, responseProcessor: IResponseProcessor) {
        let cdataBlock = node.cDATAAsString;
        switch (node.id.value) {
            case P_VIEWROOT :
                responseProcessor.replaceViewRoot(DQ.fromMarkup(cdataBlock.substring(cdataBlock.indexOf("<html"))));
                break;

            case P_VIEWHEAD:
                responseProcessor.replaceHead(DQ.fromMarkup(cdataBlock));
                break;

            case P_VIEWBODY:
                responseProcessor.replaceBody(DQ.fromMarkup(cdataBlock));
                break;

            default://htmlItem replacement
                responseProcessor.update(node, cdataBlock);
                break;

        }
    }
}