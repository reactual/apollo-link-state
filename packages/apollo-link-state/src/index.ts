import { ApolloLink, Observable, Operation, NextLink } from 'apollo-link';
import { ApolloCache } from 'apollo-cache';

import { hasDirectives, getMainDefinition } from 'apollo-utilities';
import { graphql } from 'graphql-anywhere/lib/async';

import {
  removeClientSetsFromDocument,
  fragmentFromPojo,
  queryFromPojo,
  addWriteDataToCache,
} from './utils';

const capitalizeFirstLetter = str => str.charAt(0).toUpperCase() + str.slice(1);

export type WriteDataArgs = {
  id?: string;
  data: any;
};

export type WriteData = {
  writeData: ({ id, data }: WriteDataArgs) => void;
};

export type ApolloCacheClient = ApolloCache<any> & WriteData;

export const withClientState = resolvers => {
  return new ApolloLink((operation: Operation, forward: NextLink) => {
    const isClient = hasDirectives(['client'], operation.query);

    if (!isClient) return forward(operation);

    const server = removeClientSetsFromDocument(operation.query);
    const { query } = operation;
    const type =
      capitalizeFirstLetter(
        (getMainDefinition(query) || ({} as any)).operation,
      ) || 'Query';

    const resolver = (fieldName, rootValue = {}, args, context, info) => {
      const fieldValue = rootValue[info.resultKey || fieldName];
      if (fieldValue !== undefined) return fieldValue;

      // Look for the field in the custom resolver map
      const resolve =
        resolvers[(rootValue as any).__typename || type][
          info.resultKey || fieldName
        ];
      if (resolve) return resolve(rootValue, args, context, info);
    };

    return new Observable(observer => {
      if (server) operation.query = server;
      const obs =
        server && forward ? forward(operation) : Observable.of({ data: {} });

      const sub = obs.subscribe({
        next: ({ data, errors }) => {
          const context = operation.getContext();

          // Add a writeData method to the cache
          const cache: ApolloCacheClient = context.cache;

          if (cache && !cache.writeData) {
            addWriteDataToCache(cache);
          }

          graphql(resolver, query, data, context, operation.variables).then(
            nextData => {
              observer.next({ data: nextData, errors });
              observer.complete();
            },
          );
        },
        error: observer.error.bind(observer),
      });

      return () => {
        if (sub) sub.unsubscribe();
      };
    });
  });
};
