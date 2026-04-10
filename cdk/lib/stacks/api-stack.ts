import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";

import { Construct } from "constructs";
import * as path from "path";

interface ApiStackProps extends cdk.StackProps {
  vectorBucketName: string;
  userPool: cognito.UserPool;
  webClient: cognito.UserPoolClient;
  cliClient: cognito.UserPoolClient;
  mobileClient: cognito.UserPoolClient;
  userPoolDomain: cognito.UserPoolDomain;
  customDomain?: string;
  webOrigin?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigwv2.HttpApi;
  public readonly handler: lambdaNode.NodejsFunction;
  public readonly apiEndpointHostname: string;
  public readonly chatFunctionUrlHostname: string;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      vectorBucketName,
      userPool,
      webClient,
      cliClient,
      mobileClient,
      userPoolDomain,
      customDomain,
      webOrigin,
    } = props;

    // HMAC secret for hashing agent API keys — generated once, cached in Lambda memory
    const apiKeyHmacSecret = new secretsmanager.Secret(this, "ApiKeyHmacSecret", {
      secretName: "openbrain/api-key-hmac-secret",
      description: "HMAC-SHA256 key for hashing agent API keys before storing in DynamoDB",
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });
    const hmacSecretArn = apiKeyHmacSecret.secretArn;

    // Data stack tables — referenced by hardcoded name to avoid cross-stack
    // CloudFormation imports that would block Data from removing old exports.
    const agentKeysTableName = "openbrain-agent-keys";
    const agentTasksTableName = "openbrain-agent-tasks";
    const dcrClientsTableName = "openbrain-dcr-clients";

    const agentKeysTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${agentKeysTableName}`;
    const agentTasksTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${agentTasksTableName}`;
    const dcrClientsTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${dcrClientsTableName}`;

    // Main MCP handler Lambda
    this.handler = new lambdaNode.NodejsFunction(this, "McpHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "index.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        AGENT_KEYS_TABLE: agentKeysTableName,
        AGENT_TASKS_TABLE: agentTasksTableName,
        USER_POOL_ID: userPool.userPoolId,
        COGNITO_DOMAIN: userPoolDomain.baseUrl(),
        COGNITO_CLI_CLIENT_ID: cliClient.userPoolClientId,
        COGNITO_MOBILE_CLIENT_ID: mobileClient.userPoolClientId,
        HMAC_SECRET_ARN: hmacSecretArn,
        FREE_TIER_DAILY_LIMIT: "50",
        ...(customDomain && { CUSTOM_DOMAIN: customDomain }),
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    this.handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [hmacSecretArn],
    }));

    // S3 Vectors permissions
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "s3vectors:CreateIndex",
          "s3vectors:QueryVectors",
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:ListVectors",
          "s3vectors:ListIndexes",
        ],
        resources: [
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
        ],
      })
    );

    // Bedrock permissions
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    // DynamoDB permissions for main handler
    this.handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    this.handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
      resources: [agentTasksTableArn, `${agentTasksTableArn}/index/*`],
    }));

    // Chat handler Lambda (LLM + brain tools via Bedrock Converse)
    const chatHandler = new lambdaNode.NodejsFunction(this, "ChatHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "chat.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        CHAT_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        AGENT_KEYS_TABLE: agentKeysTableName,
        AGENT_TASKS_TABLE: agentTasksTableName,
        USER_POOL_ID: userPool.userPoolId,
        HMAC_SECRET_ARN: hmacSecretArn,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    chatHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [hmacSecretArn],
    }));

    // Chat handler needs same permissions as MCP handler
    chatHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "s3vectors:CreateIndex",
          "s3vectors:QueryVectors",
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:ListVectors",
          "s3vectors:ListIndexes",
        ],
        resources: [
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
        ],
      })
    );
    chatHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );
    chatHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    chatHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
      resources: [agentTasksTableArn, `${agentTasksTableArn}/index/*`],
    }));

    // Function URL for streaming chat responses (API Gateway does not support response streaming)
    const chatFunctionUrl = chatHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: webOrigin
          ? [webOrigin, "http://localhost:5173"]
          : ["*"],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
      },
    });

    // Custom Lambda authorizer (supports both JWT and API key)
    const authorizerFn = new lambdaNode.NodejsFunction(this, "AuthorizerFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(
        __dirname,
        "..",
        "..",
        "..",
        "lambda",
        "src",
        "auth",
        "authorizer.ts"
      ),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        REGION: this.region,
        AGENT_KEYS_TABLE: agentKeysTableName,
        HMAC_SECRET_ARN: hmacSecretArn,
        // Kept to preserve cross-stack CloudFormation references from auth stack.
        // The verifier no longer checks these — it accepts any client in the pool.
        CLI_CLIENT_ID: cliClient.userPoolClientId,
        WEB_CLIENT_ID: webClient.userPoolClientId,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Authorizer needs to read and migrate agent keys
    authorizerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:UpdateItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    authorizerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [hmacSecretArn],
    }));

    const authorizer = new apigwv2Authorizers.HttpLambdaAuthorizer(
      "BrainAuthorizer",
      authorizerFn,
      {
        authorizerName: "brain-custom-authorizer",
        responseTypes: [
          apigwv2Authorizers.HttpLambdaResponseType.SIMPLE,
        ],
        identitySource: [], // Intentionally empty to support either JWT-only or API-key-only requests, and to avoid API Gateway requiring multiple identity headers (which would also affect cache key behavior if caching is re-enabled).
        resultsCacheTtl: cdk.Duration.seconds(0),
      }
    );

    // HTTP API
    // Scope CORS to known web origins when available; fall back to * only before the
    // web stack has been deployed (customDomain and webOrigin both undefined).
    const corsOriginsSet = new Set<string>();
    if (customDomain) corsOriginsSet.add(`https://${customDomain}`);
    if (webOrigin) corsOriginsSet.add(webOrigin); // already includes scheme (e.g. https://brain.example.com)
    // localhost intentionally excluded from production — falls back to * when no origin is configured
    const corsOrigins = [...corsOriginsSet];

    this.api = new apigwv2.HttpApi(this, "BrainApi", {
      apiName: "open-brain-mcp",
      corsPreflight: {
        allowOrigins: corsOrigins.length > 0 ? corsOrigins : ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.DELETE, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
      },
    });

    // Apply throttle via L1 escape hatch — HttpApiProps has no defaultStageOptions in CDK v2
    // 50 req/s sustained, 200 burst — protects against runaway agents spiking Bedrock costs
    const cfnStage = this.api.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    cfnStage.defaultRouteSettings = {
      throttlingRateLimit: 50,
      throttlingBurstLimit: 200,
    };

    const integration = new apigwv2Integrations.HttpLambdaIntegration(
      "McpIntegration",
      this.handler
    );

    // MCP route — auth handled in-Lambda (returns 401 + WWW-Authenticate for OAuth discovery)
    this.api.addRoutes({
      path: "/mcp",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET],
      integration,
    });

    // Insight route — proactive brain summary (auth handled in-Lambda)
    this.api.addRoutes({
      path: "/insight",
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    // Chat route (LLM + brain tools)
    const chatIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "ChatIntegration",
      chatHandler,
    );
    this.api.addRoutes({
      path: "/chat",
      methods: [apigwv2.HttpMethod.POST],
      integration: chatIntegration,
      authorizer,
    });

    // Brain chat Lambda — non-streaming JSON chat for native mobile/desktop apps
    const brainChatHandler = new lambdaNode.NodejsFunction(this, "BrainChatHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "brain-chat.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        CHAT_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        AGENT_KEYS_TABLE: agentKeysTableName,
        AGENT_TASKS_TABLE: agentTasksTableName,
        USER_POOL_ID: userPool.userPoolId,
        HMAC_SECRET_ARN: hmacSecretArn,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });
    brainChatHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [hmacSecretArn],
    }));
    brainChatHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "s3vectors:CreateIndex", "s3vectors:QueryVectors", "s3vectors:PutVectors",
        "s3vectors:GetVectors", "s3vectors:DeleteVectors", "s3vectors:ListVectors", "s3vectors:ListIndexes",
      ],
      resources: [
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
      ],
    }));
    brainChatHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));
    brainChatHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    brainChatHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
      resources: [agentTasksTableArn, `${agentTasksTableArn}/index/*`],
    }));
    const brainChatIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "BrainChatIntegration",
      brainChatHandler,
    );
    this.api.addRoutes({
      path: "/brain/chat",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: brainChatIntegration,
      authorizer,
    });

    // Auth config route — public, for mobile app auth flow bootstrapping
    this.api.addRoutes({
      path: "/auth/config",
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    // OAuth handler Lambda (discovery, authorization proxy, DCR)
    const oauthHandler = new lambdaNode.NodejsFunction(this, "OAuthHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "oauth.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        REGION: this.region,
        DCR_CLIENTS_TABLE: dcrClientsTableName,
        ...(customDomain && { CUSTOM_DOMAIN: customDomain }),
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    // OAuth Lambda needs to create Cognito app clients (DCR)
    oauthHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:CreateUserPoolClient",
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:UpdateUserPoolClient",
        ],
        resources: [userPool.userPoolArn],
      })
    );
    oauthHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
      resources: [dcrClientsTableArn, `${dcrClientsTableArn}/index/*`],
    }));

    const oauthIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "OAuthIntegration",
      oauthHandler,
    );

    // OAuth discovery + proxy routes (no auth required)
    this.api.addRoutes({
      path: "/.well-known/oauth-protected-resource",
      methods: [apigwv2.HttpMethod.GET],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/.well-known/oauth-authorization-server",
      methods: [apigwv2.HttpMethod.GET],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/oauth/authorize",
      methods: [apigwv2.HttpMethod.GET],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/oauth/token",
      methods: [apigwv2.HttpMethod.POST],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/register",
      methods: [apigwv2.HttpMethod.POST],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/.well-known/mcp.json",
      methods: [apigwv2.HttpMethod.GET],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/llms.txt",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.HEAD],
      integration: oauthIntegration,
    });

    // Background agent runner (scheduled hourly)
    const agentRunner = new lambdaNode.NodejsFunction(this, "AgentRunner", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "agent-runner.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        CHAT_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        AGENT_TASKS_TABLE: agentTasksTableName,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    agentRunner.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
      resources: [agentTasksTableArn, `${agentTasksTableArn}/index/*`],
    }));

    agentRunner.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "s3vectors:CreateIndex",
          "s3vectors:QueryVectors",
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:ListVectors",
          "s3vectors:ListIndexes",
        ],
        resources: [
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
        ],
      })
    );
    agentRunner.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    new events.Rule(this, "AgentRunnerSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: "Triggers the background agent runner every 5 minutes",
      targets: [new targets.LambdaFunction(agentRunner)],
    });

    // CloudWatch alarm + SNS topic for agent runner errors
    // Email subscription intentionally omitted — it triggers a new confirmation
    // email on every deploy. Subscribe via Slack webhook or similar instead.
    const alarmTopic = new sns.Topic(this, "AgentRunnerAlarmTopic", {
      displayName: "Open Brain Agent Runner Errors",
    });
    new cloudwatch.Alarm(this, "AgentRunnerErrorAlarm", {
      alarmName: "openbrain-agent-runner-errors",
      alarmDescription: "Agent runner Lambda is throwing errors",
      metric: agentRunner.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cwActions.SnsAction(alarmTopic));

    // -------------------------------------------------------------------------
    // GitHub Agent — webhook ingestion, installation registry, SQS fan-out
    // -------------------------------------------------------------------------

    // SQS — dead-letter queue + main events queue
    const githubEventsDlq = new sqs.Queue(this, "GitHubEventsDlq", {
      queueName: "github-events-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    const githubEventsQueue = new sqs.Queue(this, "GitHubEventsQueue", {
      queueName: "github-events",
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: githubEventsDlq,
        maxReceiveCount: 3,
      },
    });

    // Webhook secret — stored in Secrets Manager, referenced by name so the
    // plaintext value is never embedded in the CloudFormation template.
    const githubWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GitHubWebhookSecret",
      "openbrain/github-webhook-secret"
    );

    // GitHub installations table — referenced by name to avoid a cross-stack
    // CFN import that would constrain deployment order when Data stack changes.
    const githubInstallationsTableName = "openbrain-github-installations";
    const githubInstallationsTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${githubInstallationsTableName}`;

    // GitHub Deliveries table — deduplicates webhook deliveries to prevent replay attacks.
    const githubDeliveriesTableName = "openbrain-github-deliveries";
    const githubDeliveriesTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${githubDeliveriesTableName}`;

    // GitHub App private key — stored in Secrets Manager, referenced by name
    const githubAppIdSecretName = "openbrain/github-app-id";
    const githubAppPrivateKeySecretName = "openbrain/github-app-private-key";

    // Webhook Lambda — public endpoint, validates GitHub HMAC, enqueues events
    const githubWebhookHandler = new lambdaNode.NodejsFunction(this, "GitHubWebhookHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "github-webhook.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        GITHUB_EVENTS_QUEUE_URL: githubEventsQueue.queueUrl,
        GITHUB_WEBHOOK_SECRET_NAME: "openbrain/github-webhook-secret",
        GITHUB_INSTALLATIONS_TABLE: githubInstallationsTableName,
        GITHUB_DELIVERIES_TABLE: githubDeliveriesTableName,
        GITHUB_APP_ID_SECRET_NAME: githubAppIdSecretName,
        GITHUB_APP_PRIVATE_KEY_SECRET_NAME: githubAppPrivateKeySecretName,
        ...(process.env.OPENBRAIN_MCP_URL && { OPENBRAIN_MCP_URL: process.env.OPENBRAIN_MCP_URL }),
        ...(process.env.OPENBRAIN_AGENT_API_KEY && { OPENBRAIN_AGENT_API_KEY: process.env.OPENBRAIN_AGENT_API_KEY }),
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });
    githubEventsQueue.grantSendMessages(githubWebhookHandler);
    githubWebhookSecret.grantRead(githubWebhookHandler);
    githubWebhookHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:DeleteItem"],
      resources: [githubInstallationsTableArn],
    }));
    githubWebhookHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
      resources: [githubDeliveriesTableArn],
    }));
    githubWebhookHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${githubAppIdSecretName}*`,
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${githubAppPrivateKeySecretName}*`,
      ],
    }));

    // GitHub Agent Lambda — SQS consumer: LLM extraction + brain capture
    const githubAgentHandler = new lambdaNode.NodejsFunction(this, "GitHubAgentHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "github-agent.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(300),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        GITHUB_INSTALLATIONS_TABLE: githubInstallationsTableName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        CHAT_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        GITHUB_APP_ID_SECRET_NAME: githubAppIdSecretName,
        GITHUB_APP_PRIVATE_KEY_SECRET_NAME: githubAppPrivateKeySecretName,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });
    githubAgentHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(githubEventsQueue, { batchSize: 10 })
    );
    githubAgentHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
      resources: [githubInstallationsTableArn, `${githubInstallationsTableArn}/index/*`],
    }));
    githubAgentHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "s3vectors:CreateIndex",
        "s3vectors:QueryVectors",
        "s3vectors:PutVectors",
        "s3vectors:GetVectors",
        "s3vectors:DeleteVectors",
        "s3vectors:ListVectors",
        "s3vectors:ListIndexes",
      ],
      resources: [
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
      ],
    }));
    githubAgentHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));
    githubAgentHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${githubAppIdSecretName}*`,
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${githubAppPrivateKeySecretName}*`,
      ],
    }));

    // GitHub REST Lambda — authenticated endpoints for installation management
    const githubRestHandler = new lambdaNode.NodejsFunction(this, "GitHubRestHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "github.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        AGENT_KEYS_TABLE: agentKeysTableName,
        GITHUB_INSTALLATIONS_TABLE: githubInstallationsTableName,
        GITHUB_APP_ID_SECRET_NAME: githubAppIdSecretName,
        GITHUB_APP_PRIVATE_KEY_SECRET_NAME: githubAppPrivateKeySecretName,
        HMAC_SECRET_ARN: hmacSecretArn,
        API_URL: `https://${this.api.apiId}.execute-api.${this.region}.amazonaws.com`,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });
    githubRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:UpdateItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    githubRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [hmacSecretArn],
    }));
    githubRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
      resources: [githubInstallationsTableArn, `${githubInstallationsTableArn}/index/*`],
    }));
    githubRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${githubAppIdSecretName}*`,
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${githubAppPrivateKeySecretName}*`,
      ],
    }));

    // API routes
    const githubWebhookIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "GitHubWebhookIntegration",
      githubWebhookHandler
    );
    const githubRestIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "GitHubRestIntegration",
      githubRestHandler
    );

    // POST /github/webhook — public, GitHub HMAC validated in-Lambda
    this.api.addRoutes({
      path: "/github/webhook",
      methods: [apigwv2.HttpMethod.POST],
      integration: githubWebhookIntegration,
    });

    // POST /github/connect, GET /github/installations — auth handled in-Lambda
    this.api.addRoutes({
      path: "/github/connect",
      methods: [apigwv2.HttpMethod.POST],
      integration: githubRestIntegration,
    });
    this.api.addRoutes({
      path: "/github/installations",
      methods: [apigwv2.HttpMethod.GET],
      integration: githubRestIntegration,
    });
    this.api.addRoutes({
      path: "/github/installations/{installationId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: githubRestIntegration,
    });
    this.api.addRoutes({
      path: "/github/agent-wizard",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.PUT],
      integration: githubRestIntegration,
    });

    // -------------------------------------------------------------------------
    // User management — account deletion
    // -------------------------------------------------------------------------

    const userHandlerSlackTableName = "openbrain-slack-installations";
    const userHandlerSlackTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${userHandlerSlackTableName}`;
    const userHandlerGoogleTableName = "openbrain-google-connections";
    const userHandlerGoogleTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${userHandlerGoogleTableName}`;

    const userHandler = new lambdaNode.NodejsFunction(this, "UserHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "user.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        AGENT_KEYS_TABLE: agentKeysTableName,
        AGENT_TASKS_TABLE: agentTasksTableName,
        GITHUB_INSTALLATIONS_TABLE: githubInstallationsTableName,
        SLACK_INSTALLATIONS_TABLE: userHandlerSlackTableName,
        GOOGLE_CONNECTIONS_TABLE: userHandlerGoogleTableName,
        USER_POOL_ID: userPool.userPoolId,
        HMAC_SECRET_ARN: hmacSecretArn,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    userHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [hmacSecretArn],
    }));
    userHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3vectors:DeleteIndex"],
      resources: [
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
      ],
    }));
    userHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:BatchWriteItem", "dynamodb:UpdateItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    userHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:BatchWriteItem"],
      resources: [agentTasksTableArn, `${agentTasksTableArn}/index/*`],
    }));
    userHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:BatchWriteItem"],
      resources: [githubInstallationsTableArn, `${githubInstallationsTableArn}/index/*`],
    }));
    userHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:BatchWriteItem"],
      resources: [userHandlerSlackTableArn, `${userHandlerSlackTableArn}/index/*`],
    }));
    userHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:BatchWriteItem"],
      resources: [userHandlerGoogleTableArn, `${userHandlerGoogleTableArn}/index/*`],
    }));
    userHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["cognito-idp:AdminDeleteUser"],
      resources: [userPool.userPoolArn],
    }));

    const userIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "UserIntegration",
      userHandler
    );

    this.api.addRoutes({
      path: "/user",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: userIntegration,
    });

    // -------------------------------------------------------------------------
    // Tasks — create, list, and cancel scheduled tasks
    // -------------------------------------------------------------------------

    const tasksHandler = new lambdaNode.NodejsFunction(this, "TasksHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "tasks.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: {
        AGENT_KEYS_TABLE: agentKeysTableName,
        AGENT_TASKS_TABLE: agentTasksTableName,
        USER_POOL_ID: userPool.userPoolId,
        HMAC_SECRET_ARN: hmacSecretArn,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    tasksHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:DeleteItem"],
      resources: [agentTasksTableArn, `${agentTasksTableArn}/index/*`],
    }));
    tasksHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    tasksHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [hmacSecretArn],
    }));

    const tasksIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "TasksIntegration",
      tasksHandler
    );

    this.api.addRoutes({
      path: "/tasks",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: tasksIntegration,
    });

    this.api.addRoutes({
      path: "/tasks/{taskId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: tasksIntegration,
    });

    // -------------------------------------------------------------------------
    // Slack — webhook ingestion (signing secret verification, URL challenge)
    // -------------------------------------------------------------------------

    // Signing secret — stored in Secrets Manager, referenced by name
    const slackSigningSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "SlackSigningSecret",
      "openbrain/slack-signing-secret"
    );

    // Slack installations table — referenced by hardcoded name to avoid cross-stack CFN imports
    const slackInstallationsTableName = "openbrain-slack-installations";
    const slackInstallationsTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${slackInstallationsTableName}`;

    // Slack webhook Lambda — public endpoint, validates Slack HMAC, handles events
    const slackWebhookHandler = new lambdaNode.NodejsFunction(this, "SlackWebhookHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "slack-webhook.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        SLACK_SIGNING_SECRET_NAME: "openbrain/slack-signing-secret",
        SLACK_INSTALLATIONS_TABLE: slackInstallationsTableName,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });
    slackSigningSecret.grantRead(slackWebhookHandler);
    slackWebhookHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"],
      resources: [slackInstallationsTableArn, `${slackInstallationsTableArn}/index/*`],
    }));

    // Slack Deferred Worker — invoked asynchronously by the webhook Lambda to
    // perform brain search/capture after the 200 ack has been returned to Slack.
    const slackDeferredHandler = new lambdaNode.NodejsFunction(this, "SlackDeferredHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "slack-deferred.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });
    slackDeferredHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "s3vectors:CreateIndex",
        "s3vectors:QueryVectors",
        "s3vectors:PutVectors",
        "s3vectors:GetVectors",
        "s3vectors:DeleteVectors",
        "s3vectors:ListVectors",
        "s3vectors:ListIndexes",
      ],
      resources: [
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
      ],
    }));
    slackDeferredHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    // Allow the webhook Lambda to invoke the deferred worker asynchronously
    slackWebhookHandler.addEnvironment("SLACK_DEFERRED_FUNCTION_NAME", slackDeferredHandler.functionName);
    slackWebhookHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [slackDeferredHandler.functionArn],
    }));

    const slackWebhookIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "SlackWebhookIntegration",
      slackWebhookHandler
    );

    // POST /webhooks/slack — public, Slack HMAC validated in-Lambda
    this.api.addRoutes({
      path: "/webhooks/slack",
      methods: [apigwv2.HttpMethod.POST],
      integration: slackWebhookIntegration,
    });

    // -------------------------------------------------------------------------
    // Slack Notify — SQS-triggered Lambda that fans out channel: thoughts to Slack
    // -------------------------------------------------------------------------

    const slackNotifyDlq = new sqs.Queue(this, "SlackNotifyDlq", {
      queueName: "openbrain-slack-notify-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    const slackNotifyQueue = new sqs.Queue(this, "SlackNotifyQueue", {
      queueName: "openbrain-slack-notify",
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: slackNotifyDlq,
        maxReceiveCount: 3,
      },
    });

    const slackNotifyHandler = new lambdaNode.NodejsFunction(this, "SlackNotifyHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "slack-notify.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        SLACK_INSTALLATIONS_TABLE: slackInstallationsTableName,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    slackNotifyHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(slackNotifyQueue, { batchSize: 10 })
    );

    slackNotifyHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query"],
      resources: [slackInstallationsTableArn, `${slackInstallationsTableArn}/index/*`],
    }));

    // Allow all Lambdas that invoke handleCaptureThought to enqueue notify messages
    slackNotifyQueue.grantSendMessages(this.handler);
    slackNotifyQueue.grantSendMessages(slackDeferredHandler);
    slackNotifyQueue.grantSendMessages(slackWebhookHandler);
    slackNotifyQueue.grantSendMessages(githubAgentHandler);

    // Inject queue URL so handlers can enqueue without hard-coding the URL
    this.handler.addEnvironment("SLACK_NOTIFY_QUEUE_URL", slackNotifyQueue.queueUrl);
    slackDeferredHandler.addEnvironment("SLACK_NOTIFY_QUEUE_URL", slackNotifyQueue.queueUrl);
    slackWebhookHandler.addEnvironment("SLACK_NOTIFY_QUEUE_URL", slackNotifyQueue.queueUrl);
    githubAgentHandler.addEnvironment("SLACK_NOTIFY_QUEUE_URL", slackNotifyQueue.queueUrl);

    // -------------------------------------------------------------------------
    // Slack REST — OAuth install flow and installation management
    // -------------------------------------------------------------------------

    const slackClientIdSecretName = "openbrain/slack-client-id";
    const slackClientSecretSecretName = "openbrain/slack-client-secret";

    const slackRestHandler = new lambdaNode.NodejsFunction(this, "SlackRestHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "slack.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        AGENT_KEYS_TABLE: agentKeysTableName,
        SLACK_INSTALLATIONS_TABLE: slackInstallationsTableName,
        SLACK_CLIENT_ID_SECRET_NAME: slackClientIdSecretName,
        SLACK_CLIENT_SECRET_SECRET_NAME: slackClientSecretSecretName,
        HMAC_SECRET_ARN: hmacSecretArn,
        ...(( customDomain || webOrigin) && {
          SLACK_REDIRECT_URI: `https://${customDomain ?? webOrigin}/slack/callback`,
        }),
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    slackRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:UpdateItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    slackRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"],
      resources: [slackInstallationsTableArn, `${slackInstallationsTableArn}/index/*`],
    }));
    slackRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${slackClientIdSecretName}*`,
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${slackClientSecretSecretName}*`,
        hmacSecretArn,
      ],
    }));

    const slackRestIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "SlackRestIntegration",
      slackRestHandler
    );

    // GET /slack/install — auth handled in-Lambda, returns Slack OAuth URL
    this.api.addRoutes({
      path: "/slack/install",
      methods: [apigwv2.HttpMethod.GET],
      integration: slackRestIntegration,
    });
    // POST /slack/callback — auth handled in-Lambda, exchanges OAuth code (POST keeps code out of logs)
    this.api.addRoutes({
      path: "/slack/callback",
      methods: [apigwv2.HttpMethod.POST],
      integration: slackRestIntegration,
    });
    // GET /slack/installations — auth handled in-Lambda
    this.api.addRoutes({
      path: "/slack/installations",
      methods: [apigwv2.HttpMethod.GET],
      integration: slackRestIntegration,
    });
    // DELETE /slack/installations/{teamId} — auth handled in-Lambda
    this.api.addRoutes({
      path: "/slack/installations/{teamId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: slackRestIntegration,
    });

    // -------------------------------------------------------------------------
    // Google REST — OAuth connect flow and Gmail sync
    // -------------------------------------------------------------------------

    const googleConnectionsTableName = "openbrain-google-connections";
    const googleConnectionsTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${googleConnectionsTableName}`;

    const googleClientIdSecretName = "openbrain/google-client-id";
    const googleClientSecretSecretName = "openbrain/google-client-secret";

    const googleRestHandler = new lambdaNode.NodejsFunction(this, "GoogleRestHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "google.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        AGENT_KEYS_TABLE: agentKeysTableName,
        GOOGLE_CONNECTIONS_TABLE: googleConnectionsTableName,
        GOOGLE_CLIENT_ID_SECRET_NAME: googleClientIdSecretName,
        GOOGLE_CLIENT_SECRET_SECRET_NAME: googleClientSecretSecretName,
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        HMAC_SECRET_ARN: hmacSecretArn,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    googleRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:UpdateItem"],
      resources: [agentKeysTableArn, `${agentKeysTableArn}/index/*`],
    }));
    googleRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"],
      resources: [googleConnectionsTableArn, `${googleConnectionsTableArn}/index/*`],
    }));
    googleRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${googleClientIdSecretName}*`,
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${googleClientSecretSecretName}*`,
        hmacSecretArn,
      ],
    }));
    googleRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "s3vectors:CreateIndex",
        "s3vectors:QueryVectors",
        "s3vectors:PutVectors",
        "s3vectors:GetVectors",
        "s3vectors:DeleteVectors",
        "s3vectors:ListVectors",
        "s3vectors:ListIndexes",
      ],
      resources: [
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
      ],
    }));
    googleRestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    const googleRestIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "GoogleRestIntegration",
      googleRestHandler
    );

    // GET /google/connect — auth handled in-Lambda, returns Google OAuth URL
    this.api.addRoutes({
      path: "/google/connect",
      methods: [apigwv2.HttpMethod.GET],
      integration: googleRestIntegration,
    });
    // POST /google/callback — auth handled in-Lambda, exchanges OAuth code
    this.api.addRoutes({
      path: "/google/callback",
      methods: [apigwv2.HttpMethod.POST],
      integration: googleRestIntegration,
    });
    // GET /google/connections — auth handled in-Lambda
    this.api.addRoutes({
      path: "/google/connections",
      methods: [apigwv2.HttpMethod.GET],
      integration: googleRestIntegration,
    });
    // DELETE /google/connections — auth handled in-Lambda, email in request body
    this.api.addRoutes({
      path: "/google/connections",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: googleRestIntegration,
    });
    // POST /google/sync — auth handled in-Lambda, triggers email sync
    this.api.addRoutes({
      path: "/google/sync",
      methods: [apigwv2.HttpMethod.POST],
      integration: googleRestIntegration,
    });

    // NOTE: WAFv2 AssociateWebACL does not support HTTP API v2 (API Gateway v2)
    // stages — only REST API stages (/restapis/) are accepted as resource ARNs.
    // Common managed protections (CommonRuleSet, KnownBadInputs, IP reputation)
    // and rate limiting are applied via the CloudFront WAF in web-stack.ts instead.

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.apiEndpoint,
      exportName: "BrainApiUrl",
    });

    new cdk.CfnOutput(this, "ChatStreamUrl", {
      value: chatFunctionUrl.url,
    });

    this.apiEndpointHostname = cdk.Fn.select(2, cdk.Fn.split("/", this.api.apiEndpoint));
    this.chatFunctionUrlHostname = cdk.Fn.select(2, cdk.Fn.split("/", chatFunctionUrl.url));
    this.apiUrl = this.api.apiEndpoint;
  }
}
