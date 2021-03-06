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
import {ArrayCollector, Config, DomQuery, DomQueryCollector, Lang, LazyStream} from "../../ext/monadish";

import {Stream} from "../../ext/monadish";
import {DQ} from "../../ext/monadish";
import isString = Lang.isString;
import {EMPTY_STR, P_VIEWSTATE} from "../core/Const";


/**
 * A unified form data class
 * which builds upon our configuration.
 *
 * We cannot use standard html5 forms everywhere
 * due to api constraints on the HTML Form object in IE11
 * and due to the url encoding constraint given by the jsf.js spec
 *
 * TODO not ideal. too many encoding calls
 * probably only one needed and one overlay!
 * the entire fileinput storing probably is redundant now
 * that domquery has been fixed
 */
export class XhrFormData extends Config {

    private fileInputs = {};

    /**
     * data collector from a given form
     *
     * @param dataSource either a form as DomQuery object or an encoded url string
     * @param partialIdsArray partial ids to collect, to reduce the data sent down
     */
    constructor(private dataSource: DQ | string, private partialIdsArray?: string[], private encode = true) {
        super({});
        //a call to getViewState before must pass the encoded line
        //a call from getViewState passes the form element as datasource
        //so we have two call points
        if (isString(dataSource)) {
            this.assignEncodedString(<string>this.dataSource);
        } else {
            this.handleFormSource();
        }
    }

    /**
     * generic application of ids
     * @param executes
     */
    applyFileInputs(...executes: Array<string>) {

        let fetchInput = (id: string): DQ => {
            if (id == "@all") {
                return DQ.querySelectorAllDeep("input[type='file']");
            } else if (id == "@form") {
                return (<DQ>this.dataSource).querySelectorAllDeep("input[type='file']");
            } else {
                let element = DQ.byId(id, true);
                return this.getFileInputs(element);
            }
        };

        let inputExists = (item: DQ) => {
            return !!item.length;
        };

        let applyInput = (item: DQ) => {
            this.fileInputs[this.resolveSubmitIdentifier(<HTMLInputElement>item.getAsElem(0).value)] = true;
        };

        LazyStream.of(...executes)
            .map(fetchInput)
            .filter(inputExists)
            .each(applyInput);
    }

    private getFileInputs(rootElment: DQ): DQ {

        let resolveFileInputs = item => {

            if (item.length == 1) {
                if ((<string>item.tagName.get("booga").value).toLowerCase() == "input" &&
                    (<string>item.attr("type")?.value || '').toLowerCase() == "file") {
                    return item;
                }

                return rootElment.querySelectorAllDeep("input[type='file']");
            }
            return this.getFileInputs(item);
        };

        let itemExists = (item: DQ) => {
            return !!item?.length;
        }

        let ret = rootElment.lazyStream
            .map(resolveFileInputs)
            .filter(itemExists)
            .collect(new DomQueryCollector());

        return ret;
    }


    private handleFormSource() {
        //encode and append the issuing item if not a partial ids array of ids is passed
        /*
         * Spec. 13.3.1
         * Collect and encode input elements.
         * Additionally the hidden element javax.faces.ViewState
         * Enhancement partial page submit
         *
         */
        this.encodeSubmittableFields(this, <DQ>this.dataSource, this.partialIdsArray);

        if (this.getIf(P_VIEWSTATE).isPresent()) {
            return;
        }

        this.applyViewState(<DQ>this.dataSource);
    }

    /**
     * special case viewstate handling
     *
     * @param form the form holding the viewstate value
     */
    private applyViewState(form: DQ) {
        let viewState = form.byId(P_VIEWSTATE, true).inputValue;
        this.appendIf(viewState.isPresent(), P_VIEWSTATE).value = viewState.value;
    }

    /**
     * assignes a url encoded string to this xhrFormData object
     * as key value entry
     * @param encoded
     */
    assignEncodedString(encoded: string) {
        let keyValueEntries = decodeURIComponent(encoded).split(/&/gi);
        this.assignString(keyValueEntries);
    }

    assignString(keyValueEntries: string[]) {
        let toMerge = new Config({});

        Stream.of(...keyValueEntries)
            //split only the first =
            .map(line => line.split(/=(.*)/gi))
            //special case of having keys without values
            .map(keyVal => keyVal.length < 3 ? [keyVal?.[0] ?? [], keyVal?.[1] ?? []] : keyVal)
            .each(keyVal => {
                toMerge.append(keyVal[0]).value = keyVal?.splice(1)?.join("") ?? "";
            });
        //merge with overwrite but no append! (aka no double entries are allowed)
        this.shallowMerge(toMerge);
    }

// noinspection JSUnusedGlobalSymbols
    /**
     * @returns a Form data representation
     */
    toFormData(): FormData {
        let ret: any = new FormData();

        LazyStream.of(...Object.keys(this.value))
            .filter(key => !(key in this.fileInputs))
            .each(key => {
                Stream.of(...this.value[key]).each(item => ret.append(key, item));
            });
        Stream.of<string>(...Object.keys(this.fileInputs)).each((key: string) => {
            DQ.querySelectorAllDeep(`[name='${key}'], [id="${key}"]`).eachElem((elem: HTMLInputElement) => {
                let identifier = this.resolveSubmitIdentifier(elem);
                if (!elem?.files?.length) {
                    ret.append(identifier, elem.value);
                    return;
                }

                ret.append(identifier, elem.files[0]);
            })
        });
        return ret;
    }

    resolveSubmitIdentifier(elem: HTMLInputElement) {
        let identifier = elem.name;
        identifier = ((elem?.name ?? "").replace(/s+/gi, "") == "") ? elem.id : identifier;
        return identifier;
    }

    /**
     * returns an encoded string representation of our xhr form data
     *
     * @param defaultStr optional default value if nothing is there to encode
     */
    toString(defaultStr = EMPTY_STR): string {
        if (this.isAbsent()) {
            return defaultStr;
        }
        let entries = LazyStream.of(...Object.keys(this.value))
            .filter(key => this.value.hasOwnProperty(key))
            .flatMap(key => Stream.of(...this.value[key]).map(val => [key, val]).collect(new ArrayCollector()))
            .map(keyVal => {
                return `${encodeURIComponent(keyVal[0])}=${encodeURIComponent(keyVal[1])}`;
            })
            .collect(new ArrayCollector());

        return entries.join("&")
    }

    /**
     * determines fields to submit
     * @param {Object} targetBuf - the target form buffer receiving the data
     * @param {Node} parentItem - form element item is nested in
     * @param {Array} partialIds - ids fo PPS
     */
    private encodeSubmittableFields(targetBuf: Config,
                                    parentItem: DQ, partialIds ?: string[]) {
        let toEncode = null;
        if (this.partialIdsArray && this.partialIdsArray.length) {
            //in case of our myfaces reduced ppr we only
            //only submit the partials
            this._value = {};
            toEncode = new DQ(...this.partialIdsArray);

        } else {
            if (parentItem.isAbsent()) throw "NO_PARITEM";
            toEncode = parentItem;
        }

        //lets encode the form elements

        this.shallowMerge(toEncode.deepElements.encodeFormElement());
    }

    /**
     * checks if the given datasource is a multipart request source
     * multipart is only needed if one of the executes is a file input
     * since file inputs are stateless, they fall out of the viewstate
     * and need special handling
     */
    get isMultipartRequest(): boolean {
        return !!Object.keys(this.fileInputs).length;
    }

}