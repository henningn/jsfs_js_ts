/*! Licensed to the Apache Software Foundation (ASF) under one or more
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

import {AsyncRunnable, IAsyncRunnable} from "../util/AsyncRunnable";
import {Config, DQ} from "mona-dish";
import {Implementation} from "../AjaxImpl";

import {XhrFormData} from "./XhrFormData";
import {ErrorData} from "./ErrorData";
import {EventData} from "./EventData";
import {ExtLang} from "../util/Lang";
import {
    $faces,
    BEGIN,
    COMPLETE,
    CONTENT_TYPE,
    CTX_PARAM_MF_INTERNAL,
    CTX_PARAM_REQ_PASS_THR,
    ERROR,
    HEAD_FACES_REQ,
    MALFORMEDXML,
    NO_TIMEOUT,
    ON_ERROR,
    ON_EVENT, P_EXECUTE,
    REQ_ACCEPT,
    REQ_TYPE_GET,
    REQ_TYPE_POST, SOURCE,
    STATE_EVT_TIMEOUT,
    STD_ACCEPT,
    URL_ENCODED,
    VAL_AJAX, IDENT_NONE, CTX_PARAM_SRC_FRM_ID, CTX_PARAM_SRC_CTL_ID, CTX_PARAM_PPS
} from "../core/Const";
import {
    resolveFinalUrl,
    resolveHandlerFunc,
    resoveNamingContainerMapper
} from "./RequestDataResolver";
import failSaveExecute = ExtLang.failSaveExecute;
import {ExtConfig} from "../util/ExtDomQuery";

/**
 * Faces XHR Request Wrapper
 * as AsyncRunnable for our Asynchronous queue
 * This means from the outside the
 * xhr request is similar to a Promise in a way
 * that you can add then and catch and finally callbacks.
 *
 *
 * The idea is that we basically just enqueue
 * a single ajax request into our queue
 * and let the queue do the processing.
 *
 *
 */

export class XhrRequest extends AsyncRunnable<XMLHttpRequest> {

    private responseContext: Config;

    private stopProgress = false;


    private xhrObject = new XMLHttpRequest();
    /**
     * Required Parameters
     *
     * @param requestContext the request context with all pass through values
     * @param internalContext internal context with internal info which is passed through, not used by the user
     * Optional Parameters
     * @param timeout optional xhr timeout
     * @param ajaxType optional request type, default "POST"
     * @param contentType optional content type, default "application/x-www-form-urlencoded"
     */
    constructor(
        private requestContext: ExtConfig,
        private internalContext: Config,
        private timeout = NO_TIMEOUT,
        private ajaxType = REQ_TYPE_POST,
        private contentType = URL_ENCODED
    ) {
        super();
        // we omit promises here because we have to deal with cancel functionality,
        // and promises to not provide that (yet) instead we have our async queue
        // which uses an api internally, which is very close to promises
        this.registerXhrCallbacks((data: any) => this.resolve(data), (data: any) => this.reject(data));
    }

    start(): IAsyncRunnable<XMLHttpRequest> {

        let ignoreErr = failSaveExecute;
        let xhrObject = this.xhrObject;
        let sourceForm = DQ.byId(this.internalContext.getIf(CTX_PARAM_SRC_FRM_ID).value)

        let executesArr = () => {
            return this.requestContext.getIf(CTX_PARAM_REQ_PASS_THR, P_EXECUTE).get(IDENT_NONE).value.split(/\s+/gi);
        };

        try {
            // encoded we need to decode
            // We generated a base representation of the current form
            // in case someone has overloaded the viewState with additional decorators we merge
            // that in, there is no way around it, the spec allows it and getViewState
            // must be called, so whatever getViewState delivers has higher priority then
            // whatever the formData object delivers
            // the partialIdsArray arr is almost deprecated legacy code where we allowed to send a separate list of partial
            // ids for reduced load and server processing, this will be removed soon, we can handle the same via execute
            // anyway TODO reimplement the partial ids array, we still do not have it in jsf the way we need it
            const executes = executesArr();
            const partialIdsArray = this.internalContext.getIf(CTX_PARAM_PPS).value === true ? executes : [];
            const formData: XhrFormData = new XhrFormData(
                sourceForm,
                resoveNamingContainerMapper(this.internalContext),
                executes, partialIdsArray
            );

            this.contentType = formData.isMultipartRequest ? "undefined" : this.contentType;

            // next step the pass through parameters are merged in for post params
            this.requestContext.$nspEnabled = false;
            const requestContext = this.requestContext;
            const requestPassThroughParams = requestContext.getIf(CTX_PARAM_REQ_PASS_THR) as ExtConfig;

            // we are turning off here the jsf, faces remapping because we are now dealing with
            // pass-through parameters
            requestPassThroughParams.$nspEnabled = false;
            // this is an extension where we allow pass through parameters to be sent down additionally
            // this can be used and is used in the impl to enrich the post request parameters with additional
            // information
            try {
                formData.shallowMerge(requestPassThroughParams, true, true);
            } finally {
                // unfortunately as long as we support
                // both namespaces we have to keep manual control
                // on the key renaming before doing ops like deep copy
                this.requestContext.$nspEnabled = true;
                requestPassThroughParams.$nspEnabled = true;
            }

            this.responseContext = requestPassThroughParams.deepCopy;

            // we have to shift the internal passthroughs around to build up our response context
            let responseContext = this.responseContext;

            responseContext.assign(CTX_PARAM_MF_INTERNAL).value = this.internalContext.value;

            // per spec the onevent and onerror handlers must be passed through to the response
            responseContext.assign(ON_EVENT).value = requestContext.getIf(ON_EVENT).value;
            responseContext.assign(ON_ERROR).value = requestContext.getIf(ON_ERROR).value;

            xhrObject.open(this.ajaxType, resolveFinalUrl(sourceForm, formData, this.ajaxType), true);

            // adding timeout
            this.timeout ? xhrObject.timeout = this.timeout : null;

            // a bug in the xhr stub library prevents the setRequestHeader to be properly executed on fake xhr objects
            // normal browsers should resolve this
            // tests can quietly fail on this one
            if(this.contentType != "undefined") {
                ignoreErr(() => xhrObject.setRequestHeader(CONTENT_TYPE, `${this.contentType}; charset=utf-8`));
            }

            ignoreErr(() => xhrObject.setRequestHeader(HEAD_FACES_REQ, VAL_AJAX));

            // probably not needed anymore, will test this
            // some webkit based mobile browsers do not follow the w3c spec of
            // setting, they accept headers automatically
            ignoreErr(() => xhrObject.setRequestHeader(REQ_ACCEPT, STD_ACCEPT));

            this.sendEvent(BEGIN);
            this.sendRequest(formData);
        } catch (e) {
            // _onError
            this.handleError(e);
        }
        return this;
    }

    cancel() {
        try {
            // this causes onError to be called where the error
            // handling takes over
            this.xhrObject.abort();
        } catch (e) {
            this.handleError(e);
        }
    }



    /**
     * attaches the internal event and processing
     * callback within the promise to our xhr object
     *
     * @param resolve
     * @param reject
     */
    private registerXhrCallbacks(resolve: Consumer<any>, reject: Consumer<any>) {
        let xhrObject = this.xhrObject;

        xhrObject.onabort = () => {
            this.onAbort(reject);
        };
        xhrObject.ontimeout = () => {
            this.onTimeout(reject);
        };
        xhrObject.onload = () => {
            this.onSuccess(resolve)
        };
        xhrObject.onloadend = () => {
            this.onDone(this.xhrObject, resolve);
        };
        xhrObject.onerror = (errorData: any) => {

            // some browsers trigger an error when cancelling a request internally, or when
            // cancel is called from outside
            // in this case we simply ignore the request and clear up the queue, because
            // it is not safe anymore to proceed with the current queue
            // This bypasses a Safari issue where it keeps requests hanging after page unload
            // and then triggers a cancel error on then instead of just stopping
            // and clearing the code
            if(this.isCancelledResponse(this.xhrObject)) {
                /*
                 * this triggers the catch chain and after that finally
                 */
                reject();
                this.stopProgress = true;
                return;
            }
            this.onError(errorData, reject);
        };
    }

    private isCancelledResponse(currentTarget: XMLHttpRequest): boolean {
        return currentTarget?.status === 0 && // cancelled by browser
            currentTarget?.readyState === 4 &&
            currentTarget?.responseText === '' &&
            currentTarget?.responseXML === null;
    }

    /*
         * xhr processing callbacks
         *
         * Those methods are the callbacks called by
         * the xhr object depending on its own state
         */

    private onAbort(reject: Consumer<any>) {
        reject();
    }

    private onTimeout(reject: Consumer<any>) {
        this.sendEvent(STATE_EVT_TIMEOUT);
        reject();
    }

    private onSuccess(resolve: Consumer<any>) {

        this.sendEvent(COMPLETE);

        // malformed responses always result in empty response xml
        // per spec a valid response cannot be empty
        if (!this?.xhrObject?.responseXML) {
            this.handleMalFormedXML(resolve);
            return;
        }

        $faces().ajax.response(this.xhrObject, this.responseContext.value ?? {});
    }

    private handleMalFormedXML(resolve: Function) {
        this.stopProgress = true;
        let errorData = {
            type: ERROR,
            status: MALFORMEDXML,
            responseCode: 200,
            responseText: this.xhrObject?.responseText,
            // we remap the element just in case it gets replaced
            // it will be unremapped
            source:  this.internalContext.getIf(CTX_PARAM_SRC_CTL_ID).value
        };
        try {
            this.handleError(errorData, true);
        } finally {
            // we issue a resolve in this case to allow the system to recover
            // reject would clean up the queue
            resolve(errorData);
        }
        // non blocking non clearing
    }

    private onDone(data: any, resolve: Consumer<any>) {
        // if stop progress a special handling including resolve is already performed
        if (this.stopProgress) {
            return;
        }
        /**
         * now call the then chain
         */
        resolve(data);
    }

    private onError(errorData: any,  reject: Consumer<any>) {
        this.handleError(errorData);
        /*
         * this triggers the catch chain and after that finally
         */
        reject();
    }

    private sendRequest(formData: XhrFormData) {
        let isPost = this.ajaxType != REQ_TYPE_GET;
        if (formData.isMultipartRequest) {
            // in case of a multipart request we send in a formData object as body
            this.xhrObject.send((isPost) ? formData.toFormData() : null);
        } else {
            // in case of a normal request we send it normally
            this.xhrObject.send((isPost) ? formData.toString() : null);
        }
    }

    /*
     * other helpers
     */
    private sendEvent(evtType: string) {
        let eventData = EventData.createFromRequest(this.xhrObject, this.requestContext, evtType);
        try {
            // User code error, we might cover
            // this in onError, but also we cannot swallow it.
            // We need to resolve the local handlers lazily,
            // because some frameworks might decorate them over the context in the response
            let eventHandler = resolveHandlerFunc(this.requestContext, this.responseContext, ON_EVENT);

            Implementation.sendEvent(eventData, eventHandler);
        } catch (e) {
            e.source = e?.source ?? this.requestContext.getIf(SOURCE).value;
            this.handleError(e);
            throw e;
        }
    }

    private handleError(exception, responseFormatError: boolean = false) {
        let errorData = (responseFormatError) ? ErrorData.fromHttpConnection(exception.source, exception.type, exception.status, exception.responseText, exception.responseCode, exception.status) : ErrorData.fromClient(exception);

        let eventHandler = resolveHandlerFunc(this.requestContext, this.responseContext, ON_ERROR);
        Implementation.sendError(errorData, eventHandler);
    }
}