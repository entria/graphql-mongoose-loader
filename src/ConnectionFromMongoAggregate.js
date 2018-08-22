// @flow
import type { ConnectionArguments } from 'graphql-relay';
import type { AggregateQuery, ObjectId } from 'mongoose';

import { calculateOffsets, getPageInfo, offsetToCursor } from './ConnectionFromMongoCursor';

const cloneAggregate = (aggregate: AggregateQuery): AggregateQuery =>
  aggregate._model.aggregate(aggregate.pipeline());

export type ConnectionOptionsAggregate<LoaderResult, Ctx> = {
  aggregate: AggregateQuery,
  context: Ctx,
  args: ConnectionArguments,
  loader: (Ctx, string | ObjectId | Object) => LoaderResult,
  raw?: boolean, // loader should receive raw result
  allowDiskUse?: boolean,
};

/**
 * Your aggregate must return documents with _id fields
 *  those _id's are the ones going to be passed to the loader function
 */
async function connectionFromMongoAggregate<LoaderResult, Ctx>({
  aggregate,
  context,
  args = {},
  loader,
  raw = false,
  allowDiskUse = false,
}: ConnectionOptionsAggregate<LoaderResult, Ctx>) {
  // https://github.com/Automattic/mongoose/blob/367261e6c83e7e367cf0d3fbd2edea4c64bf1ee2/lib/aggregate.js#L46
  const clonedAggregate = cloneAggregate(aggregate).allowDiskUse(allowDiskUse);

  // $FlowFixMe
  const resultCount: Array<{ total: number }> = await cloneAggregate(aggregate).count('total');
  const totalCount = resultCount.length ? resultCount[0].total : 0;

  const {
    first,
    last,
    before,
    after,
    skip,
    limit,
    beforeOffset,
    afterOffset,
    startOffset,
    endOffset,
    startCursorOffset,
    endCursorOffset,
  } = calculateOffsets({ args, totalCount });

  // If supplied slice is too large, trim it down before mapping over it.
  clonedAggregate.skip(skip);
  // limit should never be 0 because $slice returns an error if it is.
  clonedAggregate.limit(limit || 1);

  // avoid large objects retrieval from collection
  const slice: Array<{ _id: ObjectId }> = await (raw
    ? clonedAggregate
    : clonedAggregate.project('_id'));

  const edges: Array<{
    cursor: string,
    node: LoaderResult,
  }> = slice.map((value, index) => ({
    cursor: offsetToCursor(startOffset + index),
    node: loader(context, raw ? value : value._id),
  }));

  return {
    edges,
    count: totalCount,
    endCursorOffset,
    startCursorOffset,
    pageInfo: getPageInfo({
      edges,
      before,
      after,
      first,
      last,
      afterOffset,
      beforeOffset,
      startOffset,
      endOffset,
      totalCount,
      startCursorOffset,
      endCursorOffset,
    }),
  };
}

export default connectionFromMongoAggregate;
