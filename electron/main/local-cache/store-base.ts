import type { SqliteDatabase } from "./store-types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type LocalCacheStoreRegistry = Record<string, any>;

export class LocalCacheStoreBase {
  [key: string]: any;

  constructor(
    protected readonly db: SqliteDatabase,
    private readonly getStores: () => any
  ) {
    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (property === "then") {
          return undefined;
        }
        if (Reflect.has(target, property)) {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? (value as (...args: any[]) => any).bind(receiver) : value;
        }
        const stores = target.getStores();
        if (typeof property === "string" && property in stores) {
          return stores[property];
        }
        for (const store of Object.values(stores)) {
          if (store && typeof store === "object" && property in store) {
            const value = Reflect.get(store, property);
            return typeof value === "function" ? value.bind(store) : value;
          }
        }
        return undefined;
      }
    });
  }
}
