import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({});
const MODEL_ID = process.env.EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0";

export async function generateEmbedding(text: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      inputText: text,
      dimensions: 1024,
      normalize: true,
    }),
  });

  const response = await client.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}
