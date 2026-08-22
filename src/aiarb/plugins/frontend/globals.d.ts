import type { AIARBWindowNamespace } from "./host.js";
declare global {
  interface Window {
    AIARB: AIARBWindowNamespace;
  }
}
export {};
