import createDebug from 'debug';
import shortid from 'shortid';
import type { EventChannel, EventType, ReaderId, ResourceDefinition, SystemEvent, World } from '../types.ts';

const debugEventSilly = createDebug('sc2:silly:EventChannel');

const normaliseEventType = (type?: EventType): EventType =>
    !type || type === 'build' || type === 'unit' ? 'agent' : type;

function createEventChannel({ resources }: World): EventChannel {
    let events: SystemEvent[] = [];

    let readers: ReaderId[] = [];

    const readerTypes: { [index: string]: EventType } = {};

    return {
        createReader(type) {
            const readerType = normaliseEventType(type);
            const readerId = shortid.generate();

            debugEventSilly(`new reader registered of type ${readerType}`);
            // @TODO: i think immutability is good here, but need to revisit the tax on GC
            readers = [...readers, readerId];

            // reader type is set in a separate dict for O(1) lookups during writes
            readerTypes[readerId] = readerType;
            return readerId;
        },

        removeReader(id) {
            readers = readers.filter((readerId) => readerId !== id);
        },

        read(readerId) {
            debugEventSilly(`all current events: ${events.map((event) => event.name)}`);
            const unreadEvents = events.filter((event) => event.readers.includes(readerId));
            debugEventSilly(
                `Reading events for ${readerId}, the following are unread: ${unreadEvents.map((event) => event.name)}`,
            );
            unreadEvents.forEach((event) => event.consume(readerId));

            return unreadEvents;
        },

        write(event, readerId) {
            const { frame } = resources.get();

            const eventType = event.type || 'agent';
            const matchType = normaliseEventType(eventType);
            const currentFrame = frame.getGameLoop();

            const currentReaders = readers
                .filter((reader) => (readerId ? reader !== readerId : true))
                .filter((reader) => matchType === 'all' || readerTypes[reader] === matchType);

            // @TODO: possible future perf issues - consider mutating the given event argument + creating an
            // event prototype for consume / destroy / future implemented methods
            const newEvent: SystemEvent = {
                ...event,
                data: event.data || null,
                type: eventType,
                gameLoop: currentFrame,
                readers: currentReaders,
                consume(readerId) {
                    this.readers = this.readers.filter((r) => r !== readerId);
                    debugEventSilly(
                        `consuming ${event.name} event for ${readerId} - ${this.readers.length} readers left to consume this event.`,
                    );

                    if (this.readers.length <= 0) {
                        this.destroy();
                        debugEventSilly(`${event.name} event consumed, event queue length: ${events.length}`);
                    }
                },
                destroy() {
                    events = events.filter((ev) => ev !== this);
                },
            };

            debugEventSilly(`New ${event.name} event with these readers: ${currentReaders}`);

            events = [...events, newEvent];
        },
    };
}

export const eventsResource: ResourceDefinition<'events'> = {
    name: 'events',
    create: (world) => createEventChannel(world),
};
