/**
 * Update suppliers are objects that can fetch a number of new updates from the
 * Telegram Bot API. When you call `run(bot)`, such an object will be created
 * automatically for you. It uses the passed bot to fetch updates.
 *
 * If you want to poll updates from a different source, such as a message queue,
 * you can construct your own update source by passing a custom update supplier.
 */
export interface UpdateSupplier<Y> {
    /**
     * Requests the next batch of updates of the specified size and returns them
     * as an array. The request should respect the given `AbortSignal`. If the
     * signal is raised, the currently pending request must be cancelled.
     */
    supply: (batchSize: number, signal: AbortSignal) => Promise<Y[]>;
}

/**
 * An update source is an object that acts as the source of updates for a
 * runner. It features an async generator of updates that produces batches of
 * updates in the form of arrays.
 *
 * The size of the batches can be adjusted on the fly by setting the generator
 * pace. This will prevent the generator from yielding more than the specified
 * number of updates. It may yield fewer updates.
 *
 * Update sources can be closed. If you are currently polling updates from the
 * async iterator, closing the update source will raise an abort signal.
 *
 * If you then want to start pulling updates from the source again, you can
 * simply begin iterating over the generator again.
 *
 * An active flag signals whether the update source is currently active (pulling
 * in updates) or whether it has been terminated.
 */
export interface UpdateSource<Y> {
    /**
     * Returns this source's async generator.
     */
    generator: () => AsyncGenerator<Y[]>;
    /**
     * Sets the maximal pace of the generator. This limits how many updates the
     * generator will yield.
     *
     * @param pace A positive integer that sets the maximal generator pace
     */
    setGeneratorPace(pace: number): void;
    /**
     * Returns whether the source is currently active.
     */
    isActive: () => boolean;
    /**
     * Closes the source, i.e. interrupts the current request for more updates.
     * The source can be re-opened by simply beginning to iterate over the
     * generator again.
     */
    close: () => void;
}

/**
 * Creates an update source based on the given update supplier.
 *
 * @param supplier An update supplier to use for requesting updates
 * @returns An update source
 */
export function createSource<Y>(supplier: UpdateSupplier<Y>): UpdateSource<Y> {
    let active = false;
    let controller: AbortController;
    const listener = () => {
        active = false;
    };
    let w = worker();
    let pace = Infinity;

    async function* worker() {
        active = true;
        do {
            controller = new AbortController();
            controller.signal.addEventListener("abort", listener);
            try {
                yield await supplier.supply(pace, controller.signal);
            } catch (e) {
                if (!controller.signal.aborted) throw e;
                close();
                break;
            }
        } while (active);
    }
    function close() {
        active = false;
        controller.abort();
        w = worker();
        pace = Infinity;
    }

    return {
        generator: () => w,
        setGeneratorPace: (newPace) => (pace = newPace),
        isActive: () => active,
        close: () => close(),
    };
}
