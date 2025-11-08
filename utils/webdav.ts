import {
    NZBDAV_WEBDAV_USER,
    NZBDAV_WEBDAV_PASS,
    NZBDAV_WEBDAV_URL,
    NZBDAV_WEBDAV_ROOT,
} from "../env.ts";
import { createClient } from "webdav";

let client: any = null;

export function getWebdavClient() {
    if (client) return client;

    const base = NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
    const root = (NZBDAV_WEBDAV_ROOT || "").replace(/^\/+/, "").replace(/\/+$/, "");
    const remoteURL = root ? `${base}/${root}` : base;

    client = createClient(remoteURL, {
        username: NZBDAV_WEBDAV_USER,
        password: NZBDAV_WEBDAV_PASS,
    });

    return client;
}

export type WebdavEntry = {
    name: string;
    isDirectory: boolean;
    size: number | null;
    href: string;
    type: string | null;
};

export async function listWebdavDirectory(directory: string): Promise<WebdavEntry[]> {
    const client = getWebdavClient();
    const cleanPath = directory.replace(/^\/+/, "").replace(/\/+$/, "");
    const path = cleanPath ? `/${cleanPath}` : "/";

    console.log(`[WebDAV:list] Listing ${path}`);
    const contents = await client.getDirectoryContents(path);

    return contents.map((item: any) => ({
        name: item.basename,
        isDirectory: item.type === "directory",
        size: item.size ?? null,
        href: item.filename,
        type: item.mime ?? null,
    }));
}

export function normalizeNzbdavPath(path: string): string {
    return (
        "/"
        + path
            .replace(/\\/g, "/")
            .replace(/\/\/+/g, "/")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "")
    );
}