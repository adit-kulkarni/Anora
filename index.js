const WebSocket = require("ws");
const dotenv = require("dotenv");
dotenv.config();
const Speaker = require("speaker");
const record = require("node-record-lpcm16");

function startRecording() {
  return new Promise((resolve, reject) => {
    console.log("Speak to send a message to the assistant. Press Enter when done.");
    // Create a buffer to hold the audio data
    const audioData = [];
    // Start recording in PCM16 format
    const recordingStream = record.record({
      sampleRate: 16000, // 16kHz sample rate (standard for speech recognition)
      threshold: 0, // Start recording immediately
      verbose: false,
      recordProgram: "sox", // Specify the program
    });
    // Capture audio data
    recordingStream.stream().on("data", (chunk) => {
      audioData.push(chunk); // Store the audio chunks
    });
    // Handle errors in the recording stream
    recordingStream.stream().on("error", (err) => {
      console.error("Error in recording stream:", err);
      reject(err);
    });
    // Set up standard input to listen for the Enter key press
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
  const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
  const ws = new WebSocket(url, {
      headers: {
          "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
          "OpenAI-Beta": "realtime=v1",
      },
  });
    const speaker = new Speaker({
        channels: 1, // Mono or Stereo
        bitDepth: 16, // PCM16 (16-bit audio)
        sampleRate: 24000, // Common sample rate (44.1kHz)
    });

    async function handleOpen() {        
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
          case "response.audio_transcript.delta":
            // Print partial or final transcript from user
            console.log("📝 Transcription:", message.delta);
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