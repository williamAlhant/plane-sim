var global_error = false;
var stateQ;
const tickMs = 20;
const defaultRenderFpsCap = 30;

const params = {
    frameMinDelayMs: 1000 / defaultRenderFpsCap
};
params.updateRenderFpsCap = (renderFpsCap) => {
    params.frameMinDelayMs = 1000 / renderFpsCap;
};

class StateQ {
    constructor(initState) {
        this.startTimeMs = 0;
        this.maxLength = 3;
        this.innerArray = [initState, initState];
    }

    push(newState) {
        if (this.innerArray.length >= this.maxLength) {
            throw new Error("stateQ maxLength reached");
        }
        this.innerArray.push(newState);
    }

    cyclePop(startTimeMs) {
        if (this.innerArray.length < 3) {
            throw new Error("stateQ should have >=3 entries when cycling");
        }
        this.innerArray.shift();
        this.startTimeMs = startTimeMs;
    }

    interpStart() { return this.innerArray[0]; }
    interpEnd() { return this.innerArray[1]; }
    cyclePopReady() { return this.innerArray.length >= 3; }
    full() { return this.innerArray.length == this.maxLength; }
    back() { return this.innerArray[this.innerArray.length - 1]; }
}

function calcTickUpdateUser(previousState) {
    throw new Error("Not implemented");
}

function calcTickUpdate(nowWCMs) {
    if (stateQ.full()) {
        console.debug("calcTickUpdate: stateQ.cyclePop");
        stateQ.cyclePop(nowWCMs);
    }
    console.debug("calcTickUpdate: stateQ.push");

    const newState = calcTickUpdateUser(stateQ.back());
    stateQ.push(newState);
}

function tickTimeoutCallback() {
    if (global_error) {
        console.log('tickTimeoutCallback stopping due to global_error');
        return;
    }
    try {
        const startTickUpdateWCMs = Date.now();

        calcTickUpdate(startTickUpdateWCMs);

        const afterCalcTickWCMs = Date.now();
        const nextTimeout = Math.max(0, startTickUpdateWCMs + tickMs - afterCalcTickWCMs);
        window.setTimeout(tickTimeoutCallback, nextTimeout);
    }
    catch (e) {
        global_error = true;
        throw e;
    }
}

function renderFrameUser(interpStartState, interpEndState, interpFactor) {
    throw new Error("Not implemented");
}

function renderFrame(nowWCMs) {
    while (nowWCMs > (stateQ.startTimeMs + tickMs)) {
        if (!stateQ.cyclePopReady()) {
            console.log("renderFrame: stateQ underflow");
            break;
        }
        console.debug("renderFrame: stateQ.cyclePop");
        stateQ.cyclePop(stateQ.startTimeMs + tickMs);
    }

    if (!(nowWCMs >= stateQ.startTimeMs)) {
        throw new Error("!(nowWCMs > stateQ.startTimeMs)");
    }

    const delta = nowWCMs - stateQ.startTimeMs;
    const interpFactor = Math.min((delta / tickMs), 1);
    console.debug(`renderFrame: interpFactor=${interpFactor}`);

    renderFrameUser(stateQ.interpStart(), stateQ.interpEnd(), interpFactor);
}

function frameTimeoutCallback() {
    if (global_error) {
        console.log('frameTimeoutCallback stopping due to global_error');
        return;
    }
    try {
        const startRenderWCMs = Date.now();

        renderFrame(startRenderWCMs);

        const afterRenderWCMs = Date.now();
        const nextTimeout = Math.max(0, startRenderWCMs + params.frameMinDelayMs - afterRenderWCMs);
        window.setTimeout(frameTimeoutCallback, nextTimeout);
    }
    catch (e) {
        global_error = true;
        throw e;
    }
}

function startLooping(renderFrameUserCallback, calcTickUpdateUserCallback, initState) {
    renderFrameUser = renderFrameUserCallback;
    calcTickUpdateUser = calcTickUpdateUserCallback;
    stateQ = new StateQ(initState);
    tickTimeoutCallback();
    frameTimeoutCallback();
}

export { params, startLooping, tickMs };
