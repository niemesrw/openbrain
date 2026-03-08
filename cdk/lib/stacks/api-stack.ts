import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

interface ApiStackProps extends cdk.StackProps {
  vectorBucketName: string;
  userPool: cognito.UserPool;
  userPoolClients: cognito.UserPoolClient[];
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigwv2.HttpApi;
  public readonly handler: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { vectorBucketName, userPool, userPoolClients } = props;

    // Lambda function
    this.handler = new lambdaNode.NodejsFunction(this, "McpHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "index.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
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
          `arn:aws:s3vectors:${this.region}:${this.account}:vector-bucket/${vectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:vector-bucket/${vectorBucketName}/*`,
        ],
      })
    );

    // Bedrock permissions
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          // Titan embed — standard foundation model (no cross-region profile needed)
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          // Haiku 4.5 — must use cross-region inference profile
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          // Underlying foundation models the profile routes to
          `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    // JWT authorizer
    const authorizer = new apigwv2Authorizers.HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: userPoolClients.map((c) => c.userPoolClientId),
        identitySource: ["$request.header.Authorization"],
      }
    );

    // HTTP API
    this.api = new apigwv2.HttpApi(this, "BrainApi", {
      apiName: "enterprise-brain-mcp",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.GET],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    const integration = new apigwv2Integrations.HttpLambdaIntegration(
      "McpIntegration",
      this.handler
    );

    // Authenticated route
    this.api.addRoutes({
      path: "/mcp",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });

    // Health check (no auth)
    this.api.addRoutes({
      path: "/mcp",
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.apiEndpoint,
      exportName: "BrainApiUrl",
    });
  }
}
