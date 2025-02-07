import { DecayingDeque } from "./queue.ts";

/**
 * Update consumers are objects that can process an update from the Telegram Bot
 * API. When you call `run(bot)`, such an object will be created automatically
 * for you. The passed bot will process the updates.
 *
 * If you want your the updates to be consumed by a different source, for
 * instance pushing them to a message queue, you can construct your own update
 * sink by passing a custom update consumer.
 */
export interface UpdateConsumer<Y> {
    /**
     * Consumes an update and processes it. The returned promise should resolve as
     * soon as the processeing is complete.
     */
    consume: (update: Y) => Promise<void>;
}

/**
 * An update sink is an object that acts as the sink for updates for a runner.
 * It features a handle function that takes in a batch of updates in the form of
 * an array. It returns a promise that should resolve with a positive integral
 * number soon as the sink is ready to handle further updates. The resolved
 * number indicates how many updates the sink is ready to handle next.
 *
 * Note that calles might not guarantee that this constraint is respected. While
 * update sinks can use this mechanism to signal backpressure to the caller, it
 * should be able to queue up update internally if the underlying sink cannot
 * handle updates as rapidly as they are being supplied.
 */
export interface UpdateSink<Y> {
    /**
     * Handles a batch of updates in the form of an array. Resolves with an
     * integral number of updates that the update sink can handle, as soon as this
     * value is positive.
     */
    handle: (updates: Y[]) => Promise<number>;
    /**
     * Takes a snapshot of the sink. This synchronously returns all tasks that
     * are currently being processed, in the order they were added.
     *
     * In the context of grammY, this can be useful if the runner must be
     * terminated gracefully but shall not wait for the middleware to complete,
     * for instance because some middleware performs long-running operations.
     * You can then store the updates in order to process them again if desired,
     * without losing data.
     */
    snapshot: () => Y[];
}

/**
 * Options for creating an update sink.
 */
export interface SinkOptions<Y> {
    /**
     * Maximal number of milliseconds that an update may take to be processed by
     * the underlying sink.
     */
    timeout: number;
    /**
     * Handler function that will be called with updates that process longer
     * than allowed by `timeout`. The second argument to the handler function
     * will be the unresolved promise. Note however that the timeout handler
     * itself has to be synchronous.
     */
    timeoutHandler: (update: Y, task: Promise<void>) => void;
}

/**
 * Creates an update sink that handles updates sequentially, i.e. one after
 * another. No update will be processed before the previous update has not
 * either been processed, or its processing has failed and the error has been
 * handled.
 *
 * In the context of grammY, this is also the default behavior of the built-in
 * `bot.start` method. Sequential sinks are very predictable and hence are well
 * suited for debugging your bot. They do not scale well and should hence not be
 * used in a larger bot, or one with long-running middleware.
 *
 * @param handler Update consumer
 * @param errorHandler Error handler for when the update consumer rejects
 * @param options Further options for creating the sink
 * @returns An update sink that handles updates one by one
 */
export function createSequentialSink<Y, R = unknown>(
    handler: UpdateConsumer<Y>,
    errorHandler: (error: R) => Promise<void>,
    options: SinkOptions<Y> = { timeout: Infinity, timeoutHandler: () => {} },
): UpdateSink<Y> {
    const q = new DecayingDeque(
        options.timeout,
        handler.consume,
        false,
        errorHandler,
        options.timeoutHandler,
    );
    return {
        handle: async (updates) => {
            const len = updates.length;
            for (let i = 0; i < len; i++) await q.add([updates[i]!]);
            return Infinity;
        },
        snapshot: () => q.pendingTasks(),
    };
}

/**
 * Creates an update sink that handles updates in batches. In other words, all
 * updates of one batch are processed concurrently, but one batch has to be done
 * processing before the next batch will be processed.
 *
 * In the context of grammY, creating a batch sink is rarely useful. If you want
 * to process updates concurrently, consider creating a concurrent sink. If you
 * want to process updates sequentially, consider using a sequential sink.
 *
 * This method was mainly added to provide compatibility with older frameworks
 * such as `telegraf`. If your bot specifically relies on this behavior, you may
 * want to choose creating a batch sink for compatibility reasons.
 *
 * @param handler Update consumer
 * @param errorHandler Error handler for when the update consumer rejects
 * @param options Further options for creating the sink
 * @returns An update sink that handles updates batch by batch
 */
export function createBatchSink<Y, R = unknown>(
    handler: UpdateConsumer<Y>,
    errorHandler: (error: R) => Promise<void>,
    options: SinkOptions<Y> = { timeout: Infinity, timeoutHandler: () => {} },
): UpdateSink<Y> {
    const q = new DecayingDeque(
        options.timeout,
        handler.consume,
        false,
        errorHandler,
        options.timeoutHandler,
    );
    const constInf = () => Infinity;
    return {
        handle: (updates) => q.add(updates).then(constInf),
        snapshot: () => q.pendingTasks(),
    };
}

/**
 * Creates an update sink that handles updates concurrently. In other words, new
 * updates will be fetched—and their processing will be started—before the
 * processing of older updates completes. The maximal number of concurrently
 * handled updates can be limited (default: 500).
 *
 * In the context of grammY, this is the sink that is created by default when
 * calling `run(bot)`.
 *
 * @param handler Update consumer
 * @param errorHandler Error handler for when the update consumer rejects
 * @param concurrency Maximal number of updates to process concurrently
 * @param options Further options for creating the sink
 * @returns An update sink that handles updates concurrently
 */
export function createConcurrentSink<Y, R = unknown>(
    handler: UpdateConsumer<Y>,
    errorHandler: (error: R) => Promise<void>,
    concurrency = 500,
    options: SinkOptions<Y> = { timeout: Infinity, timeoutHandler: () => {} },
): UpdateSink<Y> {
    const q = new DecayingDeque(
        options.timeout,
        handler.consume,
        concurrency,
        errorHandler,
        options.timeoutHandler,
    );
    return {
        handle: (updates) => q.add(updates),
        snapshot: () => q.pendingTasks(),
    };
}
