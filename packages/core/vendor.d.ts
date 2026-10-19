declare module 'convert-hrtime' {
    function convertHrtime(hrtime: [number, number]): { seconds: number; milliseconds: number; nanoseconds: number };
    export = convertHrtime;
}

declare module '@node-sc2/proto/root' {
    const root: import('protobufjs').Root;
    export = root;
}

declare namespace NodeSC2Proto {
    interface ProtoClient {
        observation(request?: SC2APIProtocol.RequestObservation): Promise<SC2APIProtocol.ResponseObservation>;
        leaveGame(request?: SC2APIProtocol.RequestLeaveGame): Promise<SC2APIProtocol.ResponseLeaveGame>;
        quickSave(request?: SC2APIProtocol.RequestQuickSave): Promise<SC2APIProtocol.ResponseQuickSave>;
        quickLoad(request?: SC2APIProtocol.RequestQuickLoad): Promise<SC2APIProtocol.ResponseQuickLoad>;
        saveReplay(request?: SC2APIProtocol.RequestSaveReplay): Promise<SC2APIProtocol.ResponseSaveReplay>;
        startReplay(request: SC2APIProtocol.RequestStartReplay): Promise<SC2APIProtocol.ResponseStartReplay>;
        replayInfo(request: SC2APIProtocol.RequestReplayInfo): Promise<SC2APIProtocol.ResponseReplayInfo>;
        quit(request?: SC2APIProtocol.RequestQuit): Promise<SC2APIProtocol.ResponseQuit>;
        close(): void;
    }
}

declare namespace SC2APIProtocol {
    interface PlayerSetup {
        aiBuild?: number;
    }

    interface PlayerInfo {
        aiBuild?: number;
    }

    interface RequestObservation {
        gameLoop?: number;
    }
}
