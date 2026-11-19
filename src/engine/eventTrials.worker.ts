import { compareEventTrials } from './eventTrials';

self.addEventListener('message', (event: MessageEvent<number>) => {
  self.postMessage(compareEventTrials(event.data));
});
