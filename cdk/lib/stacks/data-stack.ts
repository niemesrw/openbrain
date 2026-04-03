import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export class DataStack extends cdk.Stack {
  public readonly agentKeysTable: dynamodb.Table;
  public readonly agentTasksTable: dynamodb.Table;
  public readonly dcrClientsTable: dynamodb.Table;
  public readonly githubInstallationsTable: dynamodb.Table;
  public readonly slackInstallationsTable: dynamodb.Table;
  public readonly googleConnectionsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Agent Keys table — stores per-user API keys for AI agents
    // PK: USER#{userId}  SK: AGENT#{agentName}
    // GSI: api-key-index on apiKey for fast auth lookups
    this.agentKeysTable = new dynamodb.Table(this, "AgentKeysTable", {
      tableName: "openbrain-agent-keys",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.agentKeysTable.addGlobalSecondaryIndex({
      indexName: "api-key-index",
      partitionKey: { name: "apiKey", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Agent Tasks table — stores scheduled tasks per user
    // PK: userId  SK: taskId
    this.agentTasksTable = new dynamodb.Table(this, "AgentTasksTable", {
      tableName: "openbrain-agent-tasks",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "taskId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DCR Clients table — stores dynamic client registrations (MCP OAuth)
    // PK: clientId (Cognito app client ID)
    // GSI: cimd-url-index on cimdUrl for CIMD URL→Cognito mapping lookups
    this.dcrClientsTable = new dynamodb.Table(this, "DcrClientsTable", {
      tableName: "openbrain-dcr-clients",
      partitionKey: { name: "clientId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: "expiresAt",
    });

    this.dcrClientsTable.addGlobalSecondaryIndex({
      indexName: "cimd-url-index",
      partitionKey: { name: "cimdUrl", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GitHub Installations table — maps GitHub App installation IDs to Open Brain users
    // PK: installationId (GitHub installation ID as string)
    // GSI: user-id-index on userId for user-scoped lookups
    this.githubInstallationsTable = new dynamodb.Table(this, "GitHubInstallationsTable", {
      tableName: "openbrain-github-installations",
      partitionKey: { name: "installationId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.githubInstallationsTable.addGlobalSecondaryIndex({
      indexName: "user-id-index",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Slack Installations table — maps Slack team installs to Open Brain users
    // PK: teamId (Slack workspace/team ID)  SK: userId (Open Brain user ID)
    // GSI: user-id-index (userId) — allows listing all workspaces for a given user
    // GSI: team-slack-user-index (teamId, slackUserId) — allows looking up a brain user from a Slack event
    this.slackInstallationsTable = new dynamodb.Table(this, "SlackInstallationsTable", {
      tableName: "openbrain-slack-installations",
      partitionKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.slackInstallationsTable.addGlobalSecondaryIndex({
      indexName: "user-id-index",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.slackInstallationsTable.addGlobalSecondaryIndex({
      indexName: "team-slack-user-index",
      partitionKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "slackUserId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Google Connections table — stores Google OAuth tokens for Gmail ingestion
    // PK: userId  SK: email (Google account email)
    this.googleConnectionsTable = new dynamodb.Table(this, "GoogleConnectionsTable", {
      tableName: "openbrain-google-connections",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "email", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, "DcrClientsTableName", {
      value: this.dcrClientsTable.tableName,
      exportName: "BrainDcrClientsTableName",
    });

    new cdk.CfnOutput(this, "AgentTasksTableName", {
      value: this.agentTasksTable.tableName,
      exportName: "BrainAgentTasksTableName",
    });

    new cdk.CfnOutput(this, "AgentKeysTableName", {
      value: this.agentKeysTable.tableName,
      exportName: "BrainAgentKeysTableName",
    });
  }
}
