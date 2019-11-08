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

import * as myfacesConfig from "../api/myfaces";
import {Lang} from "./util/Lang";
import {IListener} from "./util/ListenerQueue";
import {Response} from "./xhrCore/Response";
import {XhrRequest} from "./xhrCore/XhrRequest";
import {AsynchronouseQueue} from "./util/AsyncQueue";
import {Config, Optional} from "../ext/monadish/Monad";

import {Const} from "./core/Const";
import {assert, Assertions} from "./util/Assertions";
import {XhrFormData} from "./xhrCore/XhrFormData";
import {ExtDomquery, ExtDQ} from "./util/ExtDomQuery";
import {ErrorData} from "./xhrCore/ErrorData";
import {EventData} from "./xhrCore/EventData";
import {DQ} from "../ext/monadish/DomQuery";
import {LazyStream, Stream} from "../ext/monadish";
import {AssocArrayCollector} from "../ext/monadish/SourcesCollectors";

declare var jsf: any;

enum ProjectStages {
    Production = "Production",
    Development = "Development",
    SystemTest = "SystemTest",
    UnitTest = "UnitTest"
}

/**
 * Core Implementation
 * to distinct between api and impl
 *
 * The original idea was to make the implementation pluggable
 * but this is pointless, you always can overwrite the thin api layer
 * however a dedicated api makes sense for readability reasons
 */
export class Implementation {

    private globalConfig = myfacesConfig.myfaces.config;
    /*blockfilter for the passthrough filtering; the attributes given here
     * will not be transmitted from the options into the passthrough*/
    private BLOCK_FILTER =  {
        onerror: 1,
        onevent: 1,
        render: 1,
        execute: 1,
        myfaces: 1,
        delay: 1,
        timedOut: 1,
        windowId: 1
    };
    private projectStage: string = null;
    private separator: string = null;
    private eventQueue = [];
    private errorQueue = [];
    private requestQueue = new AsynchronouseQueue<XhrRequest>();
    /*error reporting threshold*/
    private threshold = "ERROR";

    private constructor() {
    }

    private static _instance: Implementation = null;

    /**
     * singleton for now, but we probably
     * can move this code into a module
     * to avoid the initialisation via instance
     */
    static get instance(): Implementation {
        return this._instance ?? (this._instance = new Implementation());
    }

    /**
     * fetches the separator char from the given script tags
     *
     * @return {char} the separator char for the given script tags
     */
    get separatorChar(): string {
        return this?.globalConfig?.separator ??
                this?.separator ??
                (this.separator = ExtDomquery.searchJsfJsFor(/separator=([^&;]*)/).orElse(":").value);
    }

    //for testing only
    static reset() {
        this._instance = null;
    }

    /**
     * @return the project stage also emitted by the server:
     * it cannot be cached and must be delivered over the server
     * The value for it comes from the requestInternal parameter of the jsf.js script called "stage".
     */
    getProjectStage(): string | null {
        return this?.globalConfig?.projectStage ??
                this?.projectStage ??
                (this.projectStage = this.resolveProjectStateFromURL());
    }

    private resolveProjectStateFromURL(): string | null {

        /* run through all script tags and try to find the one that includes jsf.js */
        let foundStage = <string> ExtDomquery.searchJsfJsFor(/stage=([^&;]*)/).value;
        return (foundStage in ProjectStages) ? foundStage : null;
    }

    static chain(source: any, event: Event, ...funcs: EvalFuncs): boolean {

        let ret = true;
        let execute = function (func: Function | string) {
            if ("string" != typeof func) {
                return (ret = ret && ((<Function>func).call(source, event) !== false));
            } else {
                //either a function or a string can be passed in case of a string we have to wrap it into another function
                //it it is not a plain executable code but a definition
                let sourceCode = Lang.instance.trim(<string>func);
                if (sourceCode.indexOf("function ") == 0) {
                    sourceCode = `return ${sourceCode} (event)`;
                }
                return (ret = ret && (new Function("event", sourceCode).call(source, event) !== false));
            }
        };

        <any> Stream.of(...funcs).each(func => execute(func));
        return ret;
    }

    /**
     * this function has to send the ajax requests
     *
     * following request conditions must be met:
     * <ul>
     *  <li> the request must be sent asynchronously! </li>
     *  <li> the request must be a POST!!! request </li>
     *  <li> the request url must be the form action attribute </li>
     *  <li> all requests must be queued with a client side request queue to ensure the request ordering!</li>
     * </ul>
     *
     * @param {String|Node} elem any dom element no matter being it html or jsf, from which the event is emitted
     * @param {|Event|} event any javascript event supported by that object
     * @param {|Object|} options  map of options being pushed into the ajax cycle
     *
     *
     * a) transformArguments out of the function
     * b) passThrough handling with a map copy with a filter map block map
     */
    request(el: ElemDef, event?: Event, opts ?: Options) {
        const lang = Lang.instance;

        /*
         *namespace remap for our local function context we mix the entire function namespace into
         *a local function variable so that we do not have to write the entire namespace
         *all the time
         */
        event = lang.getEvent(event);

        //options not set we define a default one with nothing
        const options = new Config(opts).shallowCopy;
        const elem = DQ.byId(el || <Element>event.target);
        const elementId = elem.id;
        const requestCtx = new Config({});
        const internalCtx = new Config({});

        Assertions.assertRequestIntegrity(options, elem);

        this.applyWindowId(options);

        requestCtx.apply(Const.CTX_PARAM_PASS_THR).value = this.fetchPassthroughValues(options.value);

        requestCtx.applyIf(!!event, Const.CTX_PARAM_PASS_THR, Const.P_EVT).value = event?.type;

        /**
         * ajax pass through context with the source
         * onevent and onerror
         */
        requestCtx.apply(Const.SOURCE).value = elementId.value;

        /**
         * on event and onError...
         * those values will be traversed later on
         * also into the response context
         */
        requestCtx.apply(Const.ON_EVENT).value = options.value?.onevent;
        requestCtx.apply(Const.ON_ERROR).value = options.value?.onerror;

        /**
         * lets drag the myfaces config params also in
         */
        requestCtx.apply(Const.MYFACES).value = options.value?.myfaces;
        /**
         * fetch the parent form
         *
         * note we also add an override possibility here
         * so that people can use dummy forms and work
         * with detached objects
         */
        const configId = requestCtx.value?.myfaces?.form ?? Const.MF_NONE;
        let form: DQ = this.resolveForm(requestCtx, elem, event);

        /**
         * binding contract the javax.faces.source must be set
         */
        requestCtx.apply(Const.CTX_PARAM_PASS_THR, Const.P_PARTIAL_SOURCE).value = elementId.value;

        /**
         * javax.faces.partial.ajax must be set to true
         */
        requestCtx.apply(Const.CTX_PARAM_PASS_THR, Const.P_AJAX).value = true;

        /**
         * binding contract the javax.faces.source must be set
         */
        requestCtx.apply(Const.CTX_PARAM_PASS_THR, Const.P_PARTIAL_SOURCE).value = elementId.value;

        /**
         * if resetValues is set to true
         * then we have to set javax.faces.resetValues as well
         * as pass through parameter
         * the value has to be explicitly true, according to
         * the specs jsdoc
         */
        requestCtx.applyIf(true === options.value?.resetValues,
            Const.CTX_PARAM_PASS_THR, Const.P_RESET_VALUES).value = true;

        //additional meta information to speed things up, note internal non jsf
        //pass through options are stored under _mfInternal in the context
        internalCtx.apply(Const.CTX_PARAM_SRC_FRM_ID).value = form.id.value;
        internalCtx.apply(Const.CTX_PARAM_SRC_CTL_ID).value = elementId.value;
        internalCtx.apply(Const.CTX_PARAM_TR_TYPE).value = Const.REQ_TYPE_POST;

        //mojarra compatibility, mojarra is sending the form id as well
        //this is not documented behavior but can be determined by running
        //mojarra under blackbox conditions
        //i assume it does the same as our formId_submit=1 so leaving it out
        //wont hurt but for the sake of compatibility we are going to add it

        requestCtx.apply(Const.CTX_PARAM_PASS_THR, form.id.value).value = form.id.value;

        this.applyClientWindowId(form, requestCtx);

        this.applyExecute(options, requestCtx, form, elementId.value);
        this.applyRender(options, requestCtx, form, elementId.value);

        let delay: number = this.resolveDelay(options, requestCtx);
        let timeout: number = this.resolveTimeout(options, requestCtx);

        //now we enqueue the request as asynchronous runnable into our request
        //queue and let the queue take over the rest
        this.addRequestToQueue(elem, form, requestCtx, internalCtx, delay, timeout);
    }


    /**
     * public to make it shimmable for tests
     */
    addRequestToQueue(elem: DQ, form: DQ, reqCtx: Config, respPassThr: Config, delay = 0, timeout = 0) {
        this.requestQueue.enqueue(new XhrRequest(elem, form, reqCtx, respPassThr, [], timeout), delay);
    }

    /**
     * Spec. 13.3.3
     * Examining the response markup and updating the DOM tree
     * @param {XMLHttpRequest} request - the ajax request
     * @param {Object} context - the ajax context
     */
    response(request: XMLHttpRequest, context: Context) {
        Response.processResponse(request, context);
    }

    addOnError(errorListener: IListener<ErrorData>) {
        /*error handling already done in the assert of the queue*/
        this.errorQueue.push(errorListener);
    }

    addOnEvent(eventListener: IListener<EventData>) {
        /*error handling already done in the assert of the queue*/
        this.eventQueue.push(eventListener);
    }

    /**
     * sends an event
     */
    sendEvent(data: EventData) {
        /*now we serve the queue as well*/
        this.eventQueue.forEach(fn => fn(data));
    }

    /**
     * error handler behavior called internally
     * and only into the impl it takes care of the
     * internal message transformation to a myfaces internal error
     * and then uses the standard send error mechanisms
     * also a double error logging prevention is done as well
     *
     * @param request the request currently being processed
     * @param context the context affected by this error
     * @param exception the exception being thrown
     * @param clearRequestQueue if set to true, clears the request queue of all pending requests
     */
    stdErrorHandler(request: XMLHttpRequest,
                    context: Config,
                    exception: any,
                    clearRequestQueue = false) {
        //newer browsers do not allow to hold additional values on native objects like exceptions
        //we hence capsule it into the request, which is gced automatically
        //on ie as well, since the stdErrorHandler usually is called between requests
        //this is a valid approach
        try {
            if (this.threshold == "ERROR") {
                let errorData = ErrorData.fromClient(exception);
                this.sendError(errorData);
            }
        } finally {
            if (clearRequestQueue) {
                this.requestQueue.cleanup();
            }
        }
    }

    /**
     * implementation triggering the error chain
     *
     * @param {Object} request the request object which comes from the xhr cycle
     * @param {Object} context (Map) the context object being pushed over the xhr cycle keeping additional metadata
     * @param {String} errorName the error name
     * @param {String} errorMessage the error name
     * @param {String} responseCode response Code
     * @param {String} responseMessage response Message
     *
     * @param {String} serverErrorName the server error name in case of a server error
     * @param {String} serverErrorMessage the server error message in case of a server error
     * @param {String} caller optional caller reference for extended error messages
     * @param {String} callFunc optional caller Function reference for extended error messages
     *
     *  handles the errors, in case of an onError exists within the context the onError is called as local error handler
     *  the registered error handlers in the queue receiv an error message to be dealt with
     *  and if the projectStage is at development an alert box is displayed
     *
     *  note: we have additional functionality here, via the global config myfaces.config.defaultErrorOutput a function can be provided
     *  which changes the default output behavior from alert to something else
     *
     *
     */
    sendError(errorData: any) {

        this.errorQueue.forEach((errorCallback: Function) => {
            errorCallback(errorData);
        });
        let displayError: (string) => void = Lang.instance.getGlobalConfig("defaultErrorOutput", (console ? console.error : alert));
        displayError(errorData);
    }

    /**
     * @return the client window id of the current window, if one is given
     */
    getClientWindow(node ?: Element | string): string {
        const ALTERED = "___mf_id_altered__";
        const INIT = "___init____";

        /**
         * the search root for the dom element search
         */
        let searchRoot = new DQ(node || document.body);

        /**
         * a set of input elements holding the window id over the entire document
         */
        let windowIdHolders = searchRoot.querySelectorAll(`form #${Const.P_WIN_ID}`);

        /**
         * lazy helper to fetch the window id from the window url
         */
        let fetchWindowIdFromUrl = () => ExtDomquery.searchJsfJsFor(/jfwid=([^&;]*)/).orElse(null).value;

        /**
         * functional double check based on stream reduction
         * the values should be identical or on INIT value which is a premise to
         * skip the first check
         *
         * @param value1
         * @param value2
         */
        let doubleCheck = (value1: string, value2: string) => {
            if (value1 == ALTERED) {
                return value1;
            } else if (value1 == INIT) {
                return value2;
            } else if (value1 != value2) {
                return ALTERED;
            }
            return value2;
        };

        /**
         * helper for cleaner code, maps the value from an item
         *
         * @param item
         */
        let getValue = (item: DQ) => item.attr("value").value;
        /**
         * fetch the window id from the forms
         * window ids must be present in all forms
         * or non existent. If they exist all of them must be the same
         */
        let formWindowId: Optional<string> = searchRoot.stream.map<string>(getValue).reduce(doubleCheck, INIT);

        //if the resulting window id is set on altered then we have an unresolvable problem
        assert(formWindowId.value != ALTERED,"Multiple different windowIds found in document");

        /**
         * return the window id or null
         * prio, forms under node/document and if not given then from the url
         */
        return formWindowId.value ?? fetchWindowIdFromUrl();
    }

    /**
     * collect and encode data for a given form element (must be of type form)
     * find the javax.faces.ViewState element and encode its value as well!
     * return a concatenated string of the encoded values!
     *
     * @throws Error in case of the given element not being of type form!
     * https://issues.apache.org/jira/browse/MYFACES-2110
     */
    getViewState(form: Element | string) {
        /**
         *  typecheck assert!, we opt for strong typing here
         *  because it makes it easier to detect bugs
         */

        let element: DQ = DQ.byId(form);
        if (!element.isTag("form")) {
            throw new Error(Lang.instance.getMessage("ERR_VIEWSTATE"));
        }

        let formData = new XhrFormData(element);
        return formData.toString();
    }

    //----------------------------------------------- Private Methods ---------------------------------------------------------------------

    private applyWindowId(options: Config) {
        let windowId = options?.value?.windowId ?? ExtDomquery.windowId;
        options.applyIf(!!windowId, Const.P_WINDOW_ID).value = windowId;
        options.delete("windowId");
    }

    private applyRender(options: Config, ctx: Config, form: DQ, elementId: string) {
        if (options.getIf("render").isPresent()) {
            this.transformValues(ctx.getIf(Const.CTX_PARAM_PASS_THR).get({}), Const.P_RENDER, <string>options.getIf("render").value, form, <any>elementId);
        }
    }

    private applyExecute(options: Config, ctx: Config, form: DQ, elementId: string) {
        const PARAM_EXECUTE = Const.CTX_PARAM_EXECUTE;
        const PARAM_PASS_THR = Const.CTX_PARAM_PASS_THR;
        const P_EXECUTE = Const.P_EXECUTE;

        if (options.getIf(PARAM_EXECUTE).isPresent()) {
            /*the options must be a blank delimited list of strings*/
            /*compliance with Mojarra which automatically adds @this to an execute
             * the spec rev 2.0a however states, if none is issued nothing at all should be sent down
             */
            options.apply(PARAM_EXECUTE).value = options.getIf(PARAM_EXECUTE).value + " @this";
            this.transformValues(ctx.getIf(PARAM_PASS_THR).get({}), P_EXECUTE, <string>options.getIf(PARAM_EXECUTE).value, form, <any>elementId);
        } else {
            ctx.apply(PARAM_PASS_THR, P_EXECUTE).value = elementId;
        }
    }

    private applyClientWindowId(form: DQ, ctx: Config) {
        let clientWindow = jsf.getClientWindow(form.getAsElem(0).value);
        if (clientWindow) {
            ctx.apply(Const.CTX_PARAM_PASS_THR, Const.P_CLIENTWINDOW).value = clientWindow;
        }
    }

    /**
     * transforms the user values to the expected one
     * with the proper none all form and this handling
     * (note we also could use a simple string replace but then
     * we would have had double entries under some circumstances)
     *
     * there are several standardized constants which need a special treatment
     * like @all, @none, @form, @this
     *
     * @param targetConfig the target configuration receiving the final values
     * @param targetKey the target key
     * @param userValues the passed user values (aka input string which needs to be transformed)
     * @param issuingForm the form where the issuing element originates
     * @param issuingElementId the issuing element
     */
    private transformValues(targetConfig: Config, targetKey: string, userValues: string, issuingForm: DQ, issuingElementId: string): Config {
        //a cleaner implementation of the transform list method
        let _Lang = Lang.instance;
        let iterValues = (userValues) ? _Lang.trim(userValues).split(/\s+/gi) : [];
        let ret = [];
        let added = {};

        //the idea is simply to loop over all values and then replace
        //their generic values and filter out doubles
        //this is more readable than the old indexed based solution
        //and not really slower because we had to build up the index in our old solution
        //anyway
        for (let cnt = 0; cnt < iterValues.length; cnt++) {
            //avoid doubles
            if (iterValues[cnt] in added) {
                continue;
            }
            switch (iterValues[cnt]) {
                //@none no values should be sent
                case Const.IDENT_NONE:
                    return targetConfig.delete(targetKey);
                //@all is a pass through case according to the spec
                case Const.IDENT_ALL:
                    targetConfig.apply(targetKey).value = Const.IDENT_ALL;
                    return targetConfig;
                //@form pushes the issuing form id into our list
                case Const.IDENT_FORM:
                    ret.push(issuingForm.id.value);
                    added[issuingForm.id.value] = true;
                    break;
                //@this is replaced with the current issuing element id
                case Const.IDENT_THIS:
                    if (!(issuingElementId in added)) {
                        ret.push(issuingElementId);
                        added[issuingElementId] = true;
                    }
                    break;
                default:
                    ret.push(iterValues[cnt]);
                    added[iterValues[cnt]] = true;
            }
        }
        //We now add the target as joined list
        targetConfig.apply(targetKey).value = ret.join(" ");
        return targetConfig;
    }

    private fetchPassthroughValues(mappedOpts: { [key: string]: any }) {
        return Stream.ofAssoc(mappedOpts)
            .filter(item => !(item[0] in this.BLOCK_FILTER))
            .collect(new AssocArrayCollector());
    }

    private resolveForm(requestCtx: Config, elem: DQ, event: Event): DQ {
        const configId = requestCtx.value?.myfaces?.form ?? Const.MF_NONE; //requestCtx.getIf(Const.MYFACES, "form").orElse(Const.MF_NONE).value;
        let form: DQ = DQ
            .byId(configId)
            .orElseLazy(() => Lang.getForm(elem.getAsElem(0).value, event));
        return form
    }

    private resolveTimeout(options: Config, requestCtx: Config):number {
        let getCfg = Lang.instance.getLocalOrGlobalConfig;
        return options.getIf(Const.CTX_PARAM_TIMEOUT).value ?? getCfg(requestCtx.value, Const.CTX_PARAM_TIMEOUT, 0);
    }

    private resolveDelay(options: Config, requestCtx: Config): number {
        let getCfg = Lang.instance.getLocalOrGlobalConfig;

        return options.getIf(Const.CTX_PARAM_DELAY).value ?? getCfg(requestCtx.value, Const.CTX_PARAM_DELAY, 0);
    }

}
