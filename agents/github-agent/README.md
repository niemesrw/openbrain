# GitHub Agent — AgentCore Runtime

Python/Strands agent that processes GitHub webhook events and captures
meaningful insights to a user's private brain. Deployed to Amazon Bedrock
AgentCore Runtime.

## Architecture

```
SQS (github-events)
  └─► bridge Lambda (github-agent.ts)   ← issue #183
        └─► InvokeAgentRuntime
              └─► this agent (agent.py)
                    ├─► search_brain    ─► S3 Vectors (query)
                    └─► capture_to_brain ► S3 Vectors (put) + Bedrock
```

## Prerequisites

- Python 3.11+
- AWS credentials with access to Bedrock and S3 Vectors
- `VECTOR_BUCKET_NAME` env var (the S3 Vectors bucket name from CDK outputs)
- An agent API key is **not** required — this agent uses IAM directly

## Local development

```bash
cd agents/github-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export VECTOR_BUCKET_NAME=<your-bucket>
export AWS_REGION=us-east-1

# Terminal 1 — start the agent
python agent.py

# Terminal 2 — run smoke test
python test_local.py pr      # PR merged event
python test_local.py push    # Push event
python test_local.py release # Release published event
```

## Deploy to AgentCore Runtime

```bash
# Install the AgentCore CLI (one-time)
npm i -g @aws/agentcore-cli

# Configure (run from agents/github-agent/)
agentcore configure \
  --entrypoint agent.py \
  --non-interactive

# Set env vars in the generated agentcore.yaml:
#   VECTOR_BUCKET_NAME: <value from CDK outputs>
#   METADATA_MODEL_ID: us.anthropic.claude-haiku-4-5-20251001-v1:0
#   AWS_REGION: us-east-1

# Deploy
agentcore deploy

# Note the runtime ARN from the output — needed for CDK issue #184:
#   arn:aws:bedrock-agentcore:us-east-1:<account>:runtime/github-agent-<id>
```

After deploy, set the ARN as a GitHub Actions repo variable:

```
AGENTCORE_RUNTIME_ARN = arn:aws:bedrock-agentcore:us-east-1:<account>:runtime/github-agent-<id>
```

Note: the workflow maps this to the `GITHUB_AGENT_RUNTIME_ARN` env var for CDK/Lambda compatibility (GitHub Actions blocks repo variables starting with `GITHUB_`).

## IAM permissions required by the runtime role

The AgentCore Runtime execution role needs:

```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": [
    "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0",
    "arn:aws:bedrock:us-east-1:<account>:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-*"
  ]
},
{
  "Effect": "Allow",
  "Action": ["s3vectors:CreateIndex", "s3vectors:PutVectors", "s3vectors:QueryVectors"],
  "Resource": [
    "arn:aws:s3vectors:us-east-1:<account>:bucket/<VECTOR_BUCKET_NAME>",
    "arn:aws:s3vectors:us-east-1:<account>:bucket/<VECTOR_BUCKET_NAME>/index/*"
  ]
}
```

`agentcore deploy` creates the execution role — add these policies to it after deploy,
or configure them in `agentcore.yaml` before deploying.
