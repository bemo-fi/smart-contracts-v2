import {Slice} from "@ton/core";
import {parseDict} from "./ParseDict";

export class SliceDict extends Slice{
    readDict = <T>(keySize: number, extractor: (slice: Slice) => T) => {
        let first = this.loadRef();
        if (first) {
            return parseDict(first.beginParse(), keySize, extractor);
        } else {
            throw Error('No ref');
        }
    }
}
