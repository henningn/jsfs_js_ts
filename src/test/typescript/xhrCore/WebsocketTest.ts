import {describe} from "mocha";
import * as sinon from "sinon";
import {StandardInits} from "../frameworkBase/_ext/shared/StandardInits";
import {Implementation} from "../../../main/typescript/impl/AjaxImpl";

import {expect} from "chai";

import defaultMyFaces = StandardInits.defaultMyFaces;
import {Lang} from "../../../main/typescript/ext/monadish";
import {FakeWebsocket} from "./FakeWebsocket";
import assertType = Lang.assertType;

declare var jsf: any;

describe('Tests the jsf websocket client side api on high level (generic test without any myfaces dependencies', function () {

    beforeEach(async function () {

        let waitForResult = defaultMyFaces();

        return waitForResult.then((close) => {

            this.xhr = sinon.useFakeXMLHttpRequest();
            this.requests = [];
            this.xhr.onCreate = (xhr) => {
                this.requests.push(xhr);
            };
            (<any>global).XMLHttpRequest = this.xhr;
            (<any>window).XMLHttpRequest = this.xhr;

            this.jsfAjaxResponse = sinon.stub((<any>global).jsf.ajax, "response");

            this.fakeWebsocket = new FakeWebsocket();
            this.socket = sinon.stub(window, 'WebSocket').returns(this.fakeWebsocket);
            (<any>global).WebSocket = this.socket;

            this.pushImpl = (<any>global).PushImpl;
            this.initSpy = sinon.spy(this.pushImpl, "init");

            this.closeIt = () => {
                (<any>global).XMLHttpRequest = (<any>window).XMLHttpRequest = this.xhr.restore();
                this.jsfAjaxResponse.restore();
                this.socket.restore();
                this.initSpy.restore();
                delete (<any>global).WebSocket;
                Implementation.reset();
                close();
            }
        });

    });

    afterEach(function () {
        this.closeIt();
    });

    it("must register a channel", function (done: Function) {
        /**
         *   export function init(socketClientId: string,
         uri: string,
         channel: string,
         onopen: Function,
         onmessage: Function,
         onclose: Function,
         behaviorScripts: any,
         autoconnect: boolean) {
            PushImpl.init(socketClientId, uri, channel, onopen, onmessage, onclose, behaviorScripts, autoconnect);
        }
         */


        try {

            jsf.push.init("clientId1", "booga.ws", "mychannel", () => {
                    done();
                },
                () => {

                },
                () => {
                },
                "",
                true
            );

            expect(this.initSpy.called).to.be.true;

            let calledArgs = this.initSpy?.getCall(0)?.args;

            expect(calledArgs[0] == "clientId1").to.be.true;
            expect(calledArgs[1] == "booga.ws").to.be.true;
            expect(calledArgs[2] == "mychannel").to.be.true;

            expect(assertType(calledArgs[3], "function")).to.be.true;
            expect(assertType(calledArgs[4], "function")).to.be.true;
            expect(assertType(calledArgs[5], "function")).to.be.true;

            //implementation specific
            expect("clientId1" in this.pushImpl.components, "a component must be registered").to.be.true;
            expect("booga.ws" in this.pushImpl.sockets, "a socket must be registered").to.be.true;
        } finally {
        }
    });

    it("callbacks must be called", function (done) {


        let openCalled = false;
        let closeCalled = false;
        let messageCalled = false;

        let msg = null;
        let cnl = null;
        new Promise((resolve, reject) => {
            jsf.push.init("blarg", "booga.ws", "mychannel", () => {
                    openCalled = true;
                    this.fakeWebsocket._respond({data: '"booga"'});
                },

                (message: string, channel: string, event: any) => {
                    messageCalled = true;
                    msg = message;
                    cnl = channel;
                    resolve();
                },
                () => {
                    closeCalled = true;
                },
                "",
                true
            );
        }).finally(() => {
            expect(openCalled, "Open must have been called due to autoConnect").to.be.true;



            expect(messageCalled, "on a server response the message must have been called").to.be.true;
            expect(msg, "proper message must be passed").to.eq("booga");
            expect(cnl, "proper message must be passed").to.eq("mychannel");

            expect(closeCalled, "websocket still open").to.be.false;

            jsf.push.close("blarg");
            expect(closeCalled, "websocket now closed").to.be.true;


            done();
        });

    });


    it("manual open must work", function (done) {


        let openCalled = false;
        let closeCalled = false;
        let messageCalled = false;

        let msg = null;
        let cnl = null;
        new Promise((resolve, reject) => {
            jsf.push.init("blarg", "booga.ws", "mychannel", () => {
                    openCalled = true;
                    this.fakeWebsocket._respond({data: '"booga"'});
                },

                (message: string, channel: string, event: any) => {
                    messageCalled = true;
                    msg = message;
                    cnl = channel;
                    resolve();
                },
                () => {
                    closeCalled = true;
                },
                "",
                false
            );
            jsf.push.open("blarg");
        }).finally(() => {
            expect(openCalled, "Open must have been called due to open").to.be.true;

            expect(messageCalled, "on a server response the message must have been called").to.be.true;
            expect(msg, "proper message must be passed").to.eq("booga");
            expect(cnl, "proper message must be passed").to.eq("mychannel");

            expect(closeCalled, "websocket still open").to.be.false;

            jsf.push.close("blarg");
            expect(closeCalled, "websocket now closed").to.be.true;


            done();
        });

    });
});