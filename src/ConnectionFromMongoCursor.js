// @flow
import type { ConnectionArguments } from 'graphql-relay';
import type { ObjectId, Query } from 'mongoose';

export const PREFIX = 'mongo:';

export const base64 = (str: string): string => new Buffer(str, 'ascii').toString('base64');
export const unbase64 = (b64: string): string => new Buffer(b64, 'base64').toString('ascii');

/**
 * Rederives the offset from the cursor string
 */
export const cursorToOffset = (cursor: string): number =>
  parseInt(unbase64(cursor).substring(PREFIX.length), 10);

/**
 * Given an optional cursor and a default offset, returns the offset to use;
 * if the cursor contains a valid offset, that will be used, otherwise it will
 * be the default.
 */
export const getOffsetWithDefault = (cursor: ?string, defaultOffset: number): number => {
  if (cursor === undefined || cursor === null) {
    return defaultOffset;
  }
  const offset = cursorToOffset(cursor);
  return isNaN(offset) ? defaultOffset : offset;
};

/**
 * Creates the cursor string from an offset.
 */
export const offsetToCursor = (offset: number): string => base64(PREFIX + offset);

export type TotalCountOptions = {
  cursor: Query,
};

export const getTotalCount = async ({ cursor }: TotalCountOptions): Promise<number> => {
  const clonedCursor: Query = cursor.model.find().merge(cursor);

  return await clonedCursor.count();
};

export type OffsetOptions = {
  // Connection Args
  args: ConnectionArguments,
  // total Count
  totalCount: number,
};

export type PageInfoOffsets = {
  before: ?string,
  after: ?string,
  first: ?number,
  last: ?number,
  afterOffset: number,
  beforeOffset: number,
  startOffset: number,
  endOffset: number,
  startCursorOffset: number,
  endCursorOffset: number,
};

export type Offsets = PageInfoOffsets & {
  skip: number,
  limit: number,
};

export type PageInfoOptions<NodeType> = PageInfoOffsets & {
  edges: Array<{
    cursor: string,
    node: NodeType,
  }>,
  totalCount: number,
};

export const calculateOffsets = ({ args, totalCount }: OffsetOptions): Offsets => {
  const { after, before } = args;
  let { first, last } = args;

  // Limit the maximum number of elements in a query
  if (!first && !last) first = 10;
  if (first && first > 1000) first = 1000;
  if (last && last > 1000) last = 1000;

  const beforeOffset = getOffsetWithDefault(before, totalCount);
  const afterOffset = getOffsetWithDefault(after, -1);

  let startOffset = Math.max(-1, afterOffset) + 1;
  let endOffset = Math.min(totalCount, beforeOffset);

  if (first !== undefined) {
    endOffset = Math.min(endOffset, startOffset + first);
  }

  if (last !== undefined) {
    startOffset = Math.max(startOffset, endOffset - (last || 0));
  }

  const skip = Math.max(startOffset, 0);

  const limit = endOffset - startOffset;

  return {
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
    startCursorOffset: skip,
    endCursorOffset: limit + skip,
  };
};

export function getPageInfo<NodeType>({
  edges,
  // before,
  // after,
  // first,
  // last,
  // afterOffset,
  // beforeOffset,
  // startOffset,
  // endOffset,
  totalCount,
  startCursorOffset,
  endCursorOffset,
}: PageInfoOptions<NodeType>) {
  const firstEdge = edges[0];
  const lastEdge = edges[edges.length - 1];

  // const lowerBound = after ? afterOffset + 1 : 0;
  // const upperBound = before ? Math.min(beforeOffset, totalCount) : totalCount;

  return {
    startCursor: firstEdge ? firstEdge.cursor : null,
    endCursor: lastEdge ? lastEdge.cursor : null,
    hasPreviousPage: startCursorOffset > 0,
    hasNextPage: endCursorOffset < totalCount,
    // hasPreviousPage: last !== null ? startOffset > lowerBound : false,
    // hasNextPage: first !== null ? endOffset < upperBound : false,
  };
}

export type ConnectionOptionsCursor<LoaderResult, Ctx> = {
  cursor: Query,
  context: Ctx,
  args: ConnectionArguments,
  loader: (Ctx, string | ObjectId) => LoaderResult,
};

async function connectionFromMongoCursor<LoaderResult, Ctx>({
  cursor,
  context,
  args = {},
  loader,
}: ConnectionOptionsCursor<LoaderResult, Ctx>) {
  const clonedCursor: Query = cursor.model.find().merge(cursor);

  const totalCount: number = await getTotalCount({
    cursor: clonedCursor,
  });

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
  clonedCursor.skip(skip);
  clonedCursor.limit(limit);

  //avoid large objects retrieval from collection
  const slice: Array<{ _id: ObjectId }> = await clonedCursor.select({ _id: 1 }).exec();

  const edges = slice.map((value, index) => ({
    cursor: offsetToCursor(startOffset + index),
    node: loader(context, value._id),
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

export default connectionFromMongoCursor;
