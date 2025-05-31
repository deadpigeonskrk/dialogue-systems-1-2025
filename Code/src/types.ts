import { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import { AnyActorRef } from "xstate";

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  lastResultNLU: any;
  data_dict : {[key:string] : string };
}

export type DMEvents = SpeechStateExternalEvent | { type: "CLICK" };
