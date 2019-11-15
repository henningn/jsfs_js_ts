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

import {Const} from "./Const";
import P_VIEWSTATE = Const.P_VIEWSTATE;

export interface IdValueHolder {

    readonly id: string;
    readonly value: string;

}

/**
 * a helper class to isolate the
 * view state data processing
 */
export class ViewState implements IdValueHolder {

    nameSpace: string;

    constructor(public id: string, public value: string) {
        let viewStatePos = id.indexOf(P_VIEWSTATE);
        this.nameSpace = viewStatePos > 0 ? id.substr(viewStatePos - 1) : "";
    }

    get hasNameSpace(): boolean {
        return !!(this?.nameSpace ?? "").length;
    }
}