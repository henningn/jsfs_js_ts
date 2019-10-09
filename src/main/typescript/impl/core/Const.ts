export class Const {
    /*internal identifiers for options*/
    static IDENT_ALL = "@all";
    static IDENT_NONE = "@none";
    static IDENT_THIS = "@this";
    static IDENT_FORM = "@form";

    /*
     * [STATIC] constants
     */

    static P_PARTIAL_SOURCE = "javax.faces.source";
    static P_VIEWSTATE = "javax.faces.ViewState";
    static P_CLIENTWINDOW = "javax.faces.ClientWindow";
    static P_AJAX = "javax.faces.partial.ajax";
    static P_EXECUTE = "javax.faces.partial.execute";
    static P_RENDER = "javax.faces.partial.render";
    static P_EVT = "javax.faces.partial.event";
    static P_CLIENT_WINDOW = "javax.faces.ClientWindow";
    static P_RESET_VALUES = "javax.faces.partial.resetValues";

    static P_WINDOW_ID = "javax.faces.windowId";

    /* message types */
    static ERROR = "error";
    static EVENT = "event";

    /* event emitting stages */
    static BEGIN = "begin";
    static COMPLETE = "complete";
    static SUCCESS = "success";


    static SOURCE = "source";
    static STATUS = "status";
    static RESPONSE_TEXT = "responseText";
    static RESPONSE_XML = "responseXML";

    /*ajax errors spec 14.4.2*/
    static HTTPERROR = "httpError";
    static EMPTY_RESPONSE = "emptyResponse";
    static MALFORMEDXML = "malformedXML";
    static SERVER_ERROR = "serverError";
    static CLIENT_ERROR = "clientError";
    static TIMEOUT_EVENT = "timeout";

    static CTX_PARAM_MF_INTERNAL = "_mfInternal";



    static CTX_PARAM_SRC_FRM_ID = "_mfSourceFormId";
    static CTX_PARAM_SRC_CTL_ID = "_mfSourceControlId";
    static CTX_PARAM_TR_TYPE = "_mfTransportType";
    static CTX_PARAM_PASS_THR = "passThrgh";
    static CTX_PARAM_DELAY = "delay";
    static CTX_PARAM_RST = "resetValues";
    static CTX_PARAM_EXECUTE = "execute";


    static STAGE_DEVELOPMENT = "Development";
}