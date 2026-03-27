import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "path";

interface TelegramStackProps extends cdk.StackProps {
  /** The existing HTTP API to add the webhook route to */
  httpApi: apigwv2.HttpApi;
  vectorBucketName: string;
  telegramUsersTable: dynamodb.Table;
  telegramTokensTable: dynamodb.Table;
  /** ARN of a Secrets Manager secret containing the Telegram bot token string */
  telegramBotTokenSecretArn: string;
}

export class TelegramStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TelegramStackProps) {
    super(scope, id, props);

    const {
      httpApi,
      vectorBucketName,
      telegramUsersTable,
      telegramTokensTable,
      telegramBotTokenSecretArn,
    } = props;

    // Reference the existing Secrets Manager secret (created by user, not managed by CDK)
    const botTokenSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "TelegramBotTokenSecret",
      telegramBotTokenSecretArn
    );

    // Webhook secret token — generated at deploy time, stored as a secret
    // Telegram will include this in X-Telegram-Bot-Api-Secret-Token header
    const webhookSecret = new secretsmanager.Secret(this, "TelegramWebhookSecret", {
      secretName: "openbrain/telegram/webhook-secret",
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const telegramHandler = new lambdaNode.NodejsFunction(this, "TelegramBotHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "telegram-bot-handler.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(29), // Telegram expects response within 30s
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        TELEGRAM_USERS_TABLE: telegramUsersTable.tableName,
        TELEGRAM_TOKENS_TABLE: telegramTokensTable.tableName,
        TELEGRAM_BOT_TOKEN_SECRET_ARN: telegramBotTokenSecretArn,
        TELEGRAM_WEBHOOK_SECRET_ARN: webhookSecret.secretArn,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    // DynamoDB permissions
    telegramUsersTable.grantReadWriteData(telegramHandler);
    telegramTokensTable.grantReadWriteData(telegramHandler);

    // Secrets Manager permissions (read bot token + webhook secret)
    botTokenSecret.grantRead(telegramHandler);
    webhookSecret.grantRead(telegramHandler);

    // S3 Vectors permissions (for capture/search/browse)
    telegramHandler.addToRolePolicy(
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

    // Bedrock permissions (embeddings + metadata extraction + insight)
    telegramHandler.addToRolePolicy(
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

    const telegramIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "TelegramIntegration",
      telegramHandler
    );

    // Webhook route — no auth, verified in-Lambda via X-Telegram-Bot-Api-Secret-Token
    httpApi.addRoutes({
      path: "/webhook/telegram",
      methods: [apigwv2.HttpMethod.POST],
      integration: telegramIntegration,
    });

    new cdk.CfnOutput(this, "TelegramWebhookUrl", {
      value: `${httpApi.apiEndpoint}/webhook/telegram`,
      description: "Register this URL with Telegram: POST https://api.telegram.org/bot<TOKEN>/setWebhook",
      exportName: "TelegramWebhookUrl",
    });

    new cdk.CfnOutput(this, "TelegramWebhookSecretArn", {
      value: webhookSecret.secretArn,
      description: "ARN of the webhook secret token — pass as secret_token when registering the webhook",
      exportName: "TelegramWebhookSecretArn",
    });
  }
}
