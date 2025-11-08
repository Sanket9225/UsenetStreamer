import { md5 as encodeMd5 } from '@takker/md5';
import { encodeHex } from "@std/encoding/hex";

export function md5(string: string) {
    return encodeHex(encodeMd5(string));
}