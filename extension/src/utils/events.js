// Simple event bus to communicate between vanilla JS observers and React components
class EventEmitter {
    constructor() {
        this.events = {};
    }

    on(event, listener) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(listener);
    }

    emit(event, data) {
        if (this.events[event]) {
            this.events[event].forEach((listener) => listener(data));
        }
    }

    off(event, listenerToRemove) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(
            (listener) => listener !== listenerToRemove
        );
    }
}

export const eventBus = new EventEmitter();
