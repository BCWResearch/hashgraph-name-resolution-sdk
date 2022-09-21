"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PollingTopicSubscriber = exports.executeWithRetriesAsync = void 0;
const axios_1 = __importDefault(require("axios"));
const mirrorNode_1 = require("../mirrorNode");
const executeWithRetriesAsync = async (func, shouldRetry, maxRetries = 5) => {
    let retryNum = 0;
    while (maxRetries > 0) {
        maxRetries--;
        try {
            return await func(retryNum);
        }
        catch (err) {
            if (maxRetries <= 0 || !shouldRetry(err)) {
                throw err;
            }
            retryNum++;
        }
    }
    throw new Error("Reached maximum retries and did not rethrow error... Should not have gotten here.");
};
exports.executeWithRetriesAsync = executeWithRetriesAsync;
const sendGetRequest = async (url, authKey) => {
    return await (0, exports.executeWithRetriesAsync)(async (retryNum) => {
        // Backoff retry for each failed attempt
        await new Promise(resolve => setTimeout(resolve, retryNum * 250));
        const headers = {};
        if (authKey) {
            headers['Authorization'] = authKey;
        }
        const res = await axios_1.default.get(url, {
            headers
        });
        return res.data;
    }, () => true);
};
class PollingTopicSubscriber {
    static subscribe(networkType, topicId, onMessage, onCaughtUp, startingTimestamp = `000`, authKey) {
        let lastTimestamp = startingTimestamp;
        let calledOnCaughtUp = false;
        let cancelled = false;
        const promise = new Promise(async (resolve) => {
            const latestMessageUrl = `${(0, mirrorNode_1.getBaseUrl)(networkType)}/api/v1/topics/${topicId}/messages/?limit=1&order=desc`;
            const latestMessageResponse = await sendGetRequest(latestMessageUrl, authKey);
            let latestSequenceNumber = 0;
            if (latestMessageResponse.messages.length) {
                latestSequenceNumber = latestMessageResponse.messages[0].sequence_number;
            }
            while (!cancelled) {
                const url = `${(0, mirrorNode_1.getBaseUrl)(networkType)}/api/v1/topics/${topicId}/messages/?limit=${mirrorNode_1.MAX_PAGE_SIZE}&timestamp=gt:${lastTimestamp}`;
                const response = await sendGetRequest(url, authKey).catch((err) => {
                    console.error({
                        err,
                        message: err.message
                    });
                });
                if (!response) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
                const messages = response.messages ? response.messages : [];
                for (const message of messages) {
                    if (!cancelled) {
                        onMessage(message);
                    }
                }
                if (!calledOnCaughtUp && messages[messages.length - 1].sequence_number >= latestSequenceNumber) {
                    onCaughtUp();
                    calledOnCaughtUp = true;
                }
                if (messages.length === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
                else {
                    lastTimestamp = messages[messages.length - 1].consensus_timestamp;
                }
            }
            resolve();
        });
        // Return unsubscribe method
        return async () => {
            cancelled = true;
            await promise;
        };
    }
    ;
}
exports.PollingTopicSubscriber = PollingTopicSubscriber;
