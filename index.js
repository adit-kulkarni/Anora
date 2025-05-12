const WebSocket = require("ws");
const dotenv = require("dotenv");
dotenv.config();
const Speaker = require("speaker");
const record = require("node-record-lpcm16");



const sessionUpdate = {
  
  'type': 'session.update',
  'session': {
    'modalities': ['text', 'audio'],
    'instructions': 'prompt',

    'input_audio_format': 'pcm16',
    'output_audio_format': 'pcm16',

    'input_audio_transcription': {
      'model': 'whisper-1',
      'language': 'en'
    },
    'turn_detection': {
      'type': 'server_vad',
      'threshold': 0.5,
      'prefix_padding_ms': 300,
      'silence_duration_ms': 1000,
      'create_response': true,
    },
    'temperature': 0.8,
    'max_response_output_tokens': 4000,
  },
}



function startRecording() {
  return new Promise((resolve, reject) => {
    console.log("Speak to send a message to the assistant. Press Enter when done.");
    const audioData = [];
    const recordingStream = record.record({
      sampleRate: 24000,
      threshold: 0,
      verbose: false,
      recordProgram: "sox", 
    });

    recordingStream.stream().on("data", (chunk) => {
      audioData.push(chunk); // Store the audio chunks
    });

    recordingStream.stream().on("error", (err) => {
      console.error("Error in recording stream:", err);
      reject(err);
    });

    process.stdin.resume(); // Start listening to stdin
    process.stdin.on("data", () => {
      console.log("Recording stopped.");
      recordingStream.stop(); // Correctly stop the recording stream
      process.stdin.pause(); // Stop listening to stdin
      // Convert audio data to a single Buffer
      const audioBuffer = Buffer.concat(audioData);
      // Convert the Buffer to Base64
      const base64Audio = audioBuffer.toString("base64");
      resolve(base64Audio); // Resolve the promise with Base64 audio
    });
  });
};

function main() {
  // Connect to the API
  const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
  const ws = new WebSocket(url, {
      headers: {
          "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
          "OpenAI-Beta": "realtime=v1",
        }
      },
  );
    const speaker = new Speaker({
        channels: 1, // Mono or Stereo
        bitDepth: 16, // PCM16 (16-bit audio)
        sampleRate: 24000, // Common sample rate (44.1kHz)
    });

    async function handleOpen() {
        ws.send(JSON.stringify(sessionUpdate));

        const base64AudioData = await startRecording();
        const createConversationEvent = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_audio",
                audio: base64AudioData,
              },
            ],
          },
        };
        ws.send(JSON.stringify(createConversationEvent));
        const createResponseEvent = {
          type: "response.create",
          response: {
            modalities: ["text", "audio"],
            instructions: "Please assist the user.",
          },
        };
        ws.send(JSON.stringify(createResponseEvent));
      }


      function handleMessage(messageStr) {
        const message = JSON.parse(messageStr);

        switch (message.type) {
          case "error":
            console.log("🚨 Error:", message);
            break;
          
          case "session.created":
            console.log("🔊 Session created:", message);
            break;
          
          case "response.audio_transcript.delta":
            // Print partial or final transcript from user
            console.log("📝 Transcription:", message.delta);
            break;

          case "conversation.item.created":
            console.log(message);
            console.log("MESSAGE CONTENT:",message.item.content[0]);
            break;
          case "session.updated":
            console.log("🔊 Session Updated:", message);
            break;

          case "conversation.item.input_audio_transcription.completed":
            console.log("🗣️ You said:", message.transcript);
            break;

          case "transcription_session.update":
            console.log("🔊 Transcription Session Update:", message);
            break;
          
          case "conversation.item.input_audio_transcription.completed":
            console.log(
              `User input transcript: ${message.transcript}`
            );
            break;

          case "conversation.item.input_audio_transcription.delta":
            console.log("🗣️ You said:", message.transcript);
            break;
              
          case "response.text":
            // Assistant text content (interim or final)
            if (message.delta) {
              console.log("🧠 Assistant says:", message.delta.content.text.value);
            }
            break;
      
          case "response.audio.delta":
            // Got an audio chunk, decode and play
            const base64AudioChunk = message.delta;
            const audioBuffer = Buffer.from(base64AudioChunk, "base64");
            speaker.write(audioBuffer);
            break;
      
          case "response.audio.done":
            // Audio finished
            speaker.end();
            ws.close();
            break;
      
          default:
            console.log("ℹ️ Unhandled message type:", message.type);
            break;
        }
      }
      
      

  ws.on("open", handleOpen);
  ws.on("message", handleMessage);
}




main();