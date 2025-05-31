import { assign, createActor, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { KEY } from "./azure";
import { NLU_KEY } from "./azure";
import { DMContext, DMEvents } from "./types";

const azureLanguageCredentials = {
  endpoint: "https://wherearewe99.cognitiveservices.azure.com/language/:analyze-conversations?api-version=2024-11-15-preview" /** your Azure CLU prediction URL */,
  key: NLU_KEY /** reference to your Azure CLU key */,
  deploymentName: "appointment" /** your Azure CLU deployment */,
  projectName: "labiv_stashi" /** your Azure CLU project name */,
};

const inspector = createBrowserInspector();

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureLanguageCredentials: azureLanguageCredentials,
  azureCredentials: azureCredentials,
  azureRegion: "northeurope",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

interface GrammarEntry {
  person?: string;
  day?: string;
  time?: string;
  confirmation?: string;
  negation?: string;
}

const grammar: { [index: string]: GrammarEntry } = {
  vlad: { person: "Vladislav Maraev" },
  aya: { person: "Nayat Astaiza Soriano" },
  victoria: { person: "Victoria Daniilidou" },

};

// in this dictionar I'm storing info about 5 celebs
const celeb_info:{[key: string]: string}={
  "lorde" : "Lorde is a New Zealand singer-songwriter known for her unique voice and breakout hit Royals",
  "johnydepp" : "Johnny Depp is an American actor famous for his eccentric roles, especially Captain Jack Sparrow in Pirates of the Caribbean",
  "emmastone" : "Emma Stone is an Academy Award-winning actress known for her roles in La La Land and Easy A",
  "jenifferlawrence" : "Jennifer Lawrence is an American actress best known for playing Katniss Everdeen in The Hunger Games series",
  "bradpitt" : "Brad Pitt is a Hollywood actor and producer known for his performances in Fight Club, Once Upon a Time in Hollywood, and Ocean’s Eleven",
};


function isInGrammar(utterance: string) {
  return utterance.toLowerCase() in grammar;
}

// This function is extended version of isInGrammar, additionally I'm testing if the answer is in type that is requiered by this question.
function isInGrammar_spec(utterance: keyof typeof grammar, category: keyof GrammarEntry):boolean {
  return !!grammar[(utterance as string).toLowerCase()]?.[category];
}

function getPerson(utterance: string) {
  return (grammar[utterance.toLowerCase()] || {}).person;
}

// this function detects if given entity is detected in NLU data
function isNLUentity(utterance: any, entityCategory: any ):boolean{
  let cointains = false;
  for(let word of utterance.entities){
    console.log(word.text)
    console.log(word.category)
    if(word.category == entityCategory){
      cointains = true
    }
  }
  return cointains
}

// this function gives a word from given nlu with given entity
function getWofcategory(utterance: any, entityCategory: any): string {
  let wanted: string = "";
  for (let word of utterance.entities) {
    if (word.category == entityCategory) {
      wanted = word.text;
    }
  }
  return wanted;
}

// this function recognise intent
function recognise_intent(utterance: any, intentCategory: any):boolean{
  let is_intent = false;
  console.log("Detected intent",utterance.intents[0]["category"])
  if (utterance.intents[0]["category"] == intentCategory){
    is_intent = true
  }
  return is_intent
}

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** define your actions here */
    "spst.speak": ({ context }, params: { utterance: string }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: params.utterance,
        },
      }),
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
        value: { nlu: true }
      }),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResultNLU: null,
    lastResult: null,
    data_dict : {},

  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "App_or_celeb" },
    },

    // "Do you want to make an appointment or get information about celebrity?" state - questions. The answers is determined by recognise intent
    App_or_celeb: { 
      initial: "Prompt",
      on: {
        LISTEN_COMPLETE : [
          {
            target: "App_or_celeb.CheckGrammar",
            guard : ({context}) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ]
      },
      states: {
        Prompt : {
          entry: {type: "spst.speak", params: { utterance: `Do you want to make an appointment or get information about celebrity?`}},
          on: {SPEAK_COMPLETE : "Ask"}
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! Do you want to make an appointment or get information about celebrity?` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask : {
          entry: {type: "spst.listen"},
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => ({
                // I'm saving both normal value and NLU value
                lastResult: event.value,  
                lastResultNLU: event.nluValue,  
                // storing the value in a dict
                data_dict: {
                  ...context.data_dict, 
                  App_or_celeb: (recognise_intent(event.nluValue, "create_a_meeting") != false) ? "app" : (recognise_intent(event.nluValue, "who_is_X") != false ? 'celeb' : ''),      
                }
              })),
            },
            ASR_NOINPUT : {
              actions: assign({ lastResult: null})
            }
          }
        },
        CheckGrammar: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              // checking if the intent is appointment or celebrity info
              utterance: recognise_intent(context.lastResultNLU, "create_a_meeting") || recognise_intent(context.lastResultNLU, "who_is_X")
                ? "" 
                : `You just said: ${context.lastResult![0].utterance}. 
                   We can't detect what you wanna do. Do you want to create an appointment or get some info about celebrities.`
            })

          },
          on: { SPEAK_COMPLETE: 
            // in following guards we have three options of moving forward:
            // if user want to create a meetin
            [{guard: ({context}) => recognise_intent(context.lastResultNLU, "create_a_meeting"),
              target: "#DM.Greeting"
          },
            // if user want to get info about a celeb
            {guard: ({context}) => recognise_intent(context.lastResultNLU, "who_is_X"),
              target: "#DM.Celeb_reco"
          },
            // if answet doesn't match this categories we are asking question again
              {target: "Ask"}],
        },
        },
      }
    },

    // Choosing which celebrity you wan to know about
    Celeb_reco: { 
      initial: "Prompt",
      on: {
        LISTEN_COMPLETE : [
          {
            target: "Celeb_reco.CheckGrammar",
            guard : ({context}) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ]
      },
      states: {
        Prompt : {
          entry: {type: "spst.speak", params: { utterance: `Which celebrity do you want to get to know better?`}},
          on: {SPEAK_COMPLETE : "Ask"}
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! Do you want to make an appointment or get information about celebrity?` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask : {
          entry: {type: "spst.listen"},
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => ({
                lastResult: event.value,  
                lastResultNLU: event.nluValue,  
                // storing the value in a dict
                data_dict: {
                  ...context.data_dict, 
                  Celeb: (isNLUentity(event.nluValue, "lorde") != false) ? "lorde" : (isNLUentity(event.nluValue, "johnydepp") != false ? 'johnydepp' :(isNLUentity(event.nluValue, "jenifferlawrence") != false) ? "jenifferlawrence" : (isNLUentity(event.nluValue, "emmastone") != false) ? "emmastone": (isNLUentity(event.nluValue, "bradpitt") != false) ? "bradpitt": ''),      
                }
              })),
            
            },
            ASR_NOINPUT : {
              actions: assign({ lastResult: null})
            }
          }
        },
        CheckGrammar: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              // checking if the intent is appointment or celebrity info
              utterance: context.data_dict.Celeb != ''
                ? `${celeb_info[context.data_dict.Celeb]}` 
                : `You just said: ${context.lastResult![0].utterance}. 
                   We can't detect celebrity we know. We can tell you something about Lorde, Jeniffer Lawrence, Brad Pitt, Emma Stone or Johny Depp.`
                  })

          },
          on: { SPEAK_COMPLETE: 
            // in following guards we have three options of moving forward:
            // if user want to create a meetin
            [{guard: ({context}) => context.data_dict.Celeb != "",
              target: "#DM.Done"
          },
            // if answet doesn't match this categories we are asking question again
              {target: "Ask"}],
        },
        },
      }
    },

    // State asking question "Who do you want to meet", edited version of given greeting state
    // I deleted check grammar as separate state and instead it is substype in each main state that asks questions
    Greeting: {
      initial: "Prompt",
      on: {
        LISTEN_COMPLETE: [
          {
            target: "Greeting.CheckGrammar",
            guard: ({ context }) => !!context.lastResult,

          },
          { target: ".NoInput" },
        ],
        
      },
      states: {
        Prompt: {
          entry: 
            { type: "spst.speak", params: { utterance: ` Let's create an appoinment. Who are you meeting with?` } },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! Who are you meeting with?` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => ({

                lastResult: event.value,  
                lastResultNLU: event.nluValue,  
                // Additionaly to last result variable, I'm keeping all important answers in dictionary. They will be used later for sum up of the meeting
                data_dict: {
                  ...context.data_dict,   
                  Q1: getWofcategory(event.nluValue, "person")          
                }
              })), 
            },
            
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
          },
        },
        CheckGrammar: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              // Here I'm using my extended function, that includes category of the object in grammar. If object is from wrong category, the program will repeat the question, and will continue only if the word is in the frammar and category matches.
              // utterance: isInGrammar_spec(context.lastResult![0].utterance, "person")
              utterance: isNLUentity(context.lastResultNLU, "person")

                ? "" 
                : `You just said: ${context.lastResult![0].utterance}. 
                   I can't detect a person. Who are you meeting with?`
            })

          },
          on: { SPEAK_COMPLETE: 
            [{guard: ({context}) => isNLUentity(context.lastResultNLU, "person"),

              target: "#DM.Q2"
          },
              {target: "Ask"}],
        },
        },

      },
    },

    // "On which day is your meeting?" state - questions. The answers can be only days of the week
    Q2: { 
      initial: "Prompt",
      on: {
        LISTEN_COMPLETE : [
          {
            target: "Q2.CheckGrammar",
            guard : ({context}) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ]
      },
      states: {
        Prompt : {
          entry: {type: "spst.speak", params: { utterance: `On which day is your meeting?`}},
          on: {SPEAK_COMPLETE : "Ask"}
        },

        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! On which day is your meeting?` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },

        Ask : {
          entry: {type: "spst.listen"},
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => ({
                lastResult: event.value,      
                // I'm adding NLU Value last result data storage
                lastResultNLU: event.nluValue,  
                // storing the value in a dict
                data_dict: {
                  ...context.data_dict,   
                // Adding nlu value to my dictionary
                  Q2: getWofcategory(event.nluValue, "week_day")         
                }
              })),
            
},
            ASR_NOINPUT : {
              actions: assign({ lastResult: null})
            }
          }
        },
        CheckGrammar: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              // again, checking if the category of the input is "day"
              utterance: isNLUentity(context.lastResultNLU, "week_day")
                ? "" 
                : `You just said: ${context.lastResult![0].utterance}. 
                   I can't detect a week day. On which day is your meeting?`
            })

          },
          on: { SPEAK_COMPLETE: 
            [{guard: ({context}) => isNLUentity(context.lastResultNLU, "week_day"),
              target: "#DM.Q3"
          },
              {target: "Ask"}],
        },
        },
      }
    },

    // "Will it take the whole day?" state - questions. The answers can be only yes, no, naah ect
    Q3: { 
      initial: "Prompt",
      on: {
        LISTEN_COMPLETE : [
          {
            target: "Q3.CheckGrammar",
            guard : ({context}) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ]
      },
      states: {
        Prompt : {
          entry: {type: "spst.speak", params: { utterance: `Will it take the whole day?`}},
          on: {SPEAK_COMPLETE : "Ask"}
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! Will it take the whole day?` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask : {
          entry: {type: "spst.listen"},
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => ({
                lastResult: event.value,  
                lastResultNLU: event.nluValue,  
                // storing the value in a dict
                data_dict: {
                  ...context.data_dict, 
                  // saving the answer in main dictionary as a string so I will be able to use it in a future 
                  Q3: (getWofcategory(event.nluValue, "confirmation") != "") ? "conf" : (getWofcategory(event.nluValue, "negation") != "" ? 'neg' : ''),      
                }
              })),
            
},
            ASR_NOINPUT : {
              actions: assign({ lastResult: null})
            }
          }
        },
        CheckGrammar: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              // checking if the category is either "confirmation" or "negation"
              utterance: isNLUentity(context.lastResultNLU, "confirmation") || isNLUentity(context.lastResultNLU, "negation")
                ? "" 
                : `You just said: ${context.lastResult![0].utterance}. 
                   We can't detection neither confirmation nor negation. Will it take the whole day? Yes or no?`
            })

          },
          on: { SPEAK_COMPLETE: 
            // in following guards we have three options of moving forward:
            // if confirmation we are jumping to sumup
            [{guard: ({context}) => isNLUentity(context.lastResultNLU, "confirmation"),
              target: "#DM.SumUp"
          },
            // if negation we are going to question 4 that ask for precise time during the day
            {guard: ({context}) => isNLUentity(context.lastResultNLU, "negation"),
              target: "#DM.Q4"
          },
            // if answet doesn't match this categories we are asking question again
              {target: "Ask"}],
        },
        },
      }
    },

    // "What time do you want to have a meeting" state - questions. The answers can be only full hours, or full hours +PM or +AM
    Q4: { 
      initial: "Prompt",
      on: {
        LISTEN_COMPLETE : [
          {
            target: "Q4.CheckGrammar",
            guard : ({context}) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ]
      },
      states: {
        Prompt : {
          entry: {type: "spst.speak", params: { utterance: `What time do you want to have a meeting?`}},
          on: {SPEAK_COMPLETE : "Ask"}
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! What time do you want to have a meeting?` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        
        Ask : {
          entry: {type: "spst.listen"},
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => ({
                lastResult: event.value,  
                lastResultNLU: event.nluValue,  
                // storing the value in a dict
                data_dict: {
                  ...context.data_dict,   
                  Q4: getWofcategory(event.nluValue, "time")         
                }
              })),
            
},
            ASR_NOINPUT : {
              actions: assign({ lastResult: null})
            }
          }
        },
        CheckGrammar: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              // checking if the category is "time"
              utterance: isNLUentity(context.lastResultNLU, "time")
                ? "" 
                : `You just said: ${context.lastResult![0].utterance}. 
                   I can't detect time. The meeting can only start at a full hour. What time do you want to have a meeting?`
            })

          },
          on: { SPEAK_COMPLETE: 
            [{guard: ({context}) => isNLUentity(context.lastResultNLU, "time"),
              target: "#DM.SumUp"
          },
              {target: "Ask"}],
        },
        },
      }
    },

    // SumUp state in wheach the user is confirming whether he wants the meeting or no. The answers can be only confirmation or negation
    SumUp: { initial: "Prompt",
      on: {
        LISTEN_COMPLETE : [
          {
            target: "SumUp.CheckGrammar",
            guard : ({context}) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ]
      },
      states: {
        Prompt: {
          entry: {
            type: "spst.speak", 
            params: ({context}) => ({
              // Here the program is summing up all the data that were kept in dictionary. First it takes the stored value for person and day
              utterance: `Do you want me to create an appoinment with ${context.data_dict.Q1}, on ${context.data_dict.Q2}` +
              // And than it differentiates whether the meeting takes whole day or it's at specific hour
              (context.data_dict.Q3 == "conf"
              ? `for the whole day?`
              : `at ${context.data_dict.Q4} ?`)
              })
            },
            on: {SPEAK_COMPLETE : "Ask"}
          },
            NoInput: {
              entry: {
                type: "spst.speak",
                params: { utterance: `I can't hear you! Do you confirm the meeting?` },
              },
              on: { SPEAK_COMPLETE: "Ask" },
            },
            Ask : {
              entry: {type: "spst.listen"},
              on: {
                RECOGNISED: {
                  // we don't need to store this answer in dictionary anymore
                  actions: assign(({ event }) => ({
                    lastResult: event.value, 
                    lastResultNLU: event.nluValue, 

                  })),
                
    },
                ASR_NOINPUT : {
                  actions: assign({ lastResult: null})
                }
              }
            },
            CheckGrammar: {
              entry: 
                {
                  type: "spst.speak",
                  params: ({context}) => ({
                  // Depends if the user confirms the meeting he will three options 
                  utterance: isNLUentity(context.lastResultNLU, "confirmation")
                  // confirmation
                  ? "Thank you, your meeting has been created."
                  :isNLUentity(context.lastResultNLU, "negation")
                  // negation
                  ?""
                  // other
                  :`You just said: ${context.lastResult![0].utterance}. We don't recognize your answer. Do you confirm this meeting? Yes or no?`
                  })
                },
              on: { SPEAK_COMPLETE: 
                // Depends if the user confirms the meeting he will continue to following states 
                // confirmation -> the end of program
                [{guard: ({context}) => isNLUentity(context.lastResultNLU, "confirmation"),
                  target: "#DM.Done"
              },
                // negation -> state that will ask him if he wants to repeat the whole process
                {guard: ({context}) => isNLUentity(context.lastResultNLU, "negation"),
                  target: "#DM.Repeat"
              },
                // wrong category -> repeat the question
                  {target: "Ask"}],
            },}
            

        },
      },

      
      // This state is only used if user doesn't confirm(says no) to the summed up proposition of meeting. Here he can decide if he's going through the process again.
      // question: "Would you like to try creating the appointment again?""
      Repeat: { 
        initial: "Prompt",
        on: {
          LISTEN_COMPLETE : [
            {
              target: "Repeat.CheckGrammar",
              guard : ({context}) => !!context.lastResult,
            },
            { target: ".NoInput" },
          ]
        },
        states: {
          Prompt : {
            entry: {type: "spst.speak", params: { utterance: `Would you like to try creating the appointment or get to know a celebrity?`}},
            on: {SPEAK_COMPLETE : "Ask"}
          },
          NoInput: {
            entry: {
              type: "spst.speak",
              params: { utterance: `I can't hear you! Would you like to try creating the appointment again?` },
            },
            on: { SPEAK_COMPLETE: "Ask" },
          },
          Ask : {
            entry: {type: "spst.listen"},
            on: {
              RECOGNISED: {
                // we don't need to store this answer in dictionary anymore
                actions: assign(({event }) => ({
                  lastResult: event.value,  
                  lastResultNLU: event.nluValue,  

                })),
              
  },
              ASR_NOINPUT : {
                actions: assign({ lastResult: null})
              }
            }
          },
          CheckGrammar: {
            entry: {
              type: "spst.speak",
              params: ({context}) => ({
                // Again three speech answers of the machine:
                utterance: isNLUentity(context.lastResultNLU, "confirmation")
                // confirmation
                ? ""
                :isNLUentity(context.lastResultNLU, "negation")
                // negation
                ?"Thank you for your time, have a nice day"
                // neither = wrong categories
                :`You just said: ${context.lastResult![0].utterance}. We don't have this option. Would you like to try creating the appointment again? Yes or no?`
                })
  
            },
            on: { SPEAK_COMPLETE:
              // Three options of moving forward
              // Confirmation -> we are repeating the whole process of creating of an appointment
              [{guard: ({context}) => isNLUentity(context.lastResultNLU, "confirmation"),
                target: "#DM.Greeting"
            },
              // Negation -> machine switches off
              {guard: ({context}) => isNLUentity(context.lastResultNLU, "negation"),
                target: "#DM.Done"
            },
              // Not correct category -> repeat the question
                {target: "Ask"}],
          },
          },
        }
      },

      Done: {
        on: {
          CLICK: "Greeting",
        },
      },
    },
  },
);

const dmActor = createActor(dmMachine, {
  inspect: inspector.inspect,
}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
