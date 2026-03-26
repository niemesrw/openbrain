import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export class DataStack extends cdk.Stack {
  public readonly agentKeysTable: dynamodb.Table;
  public readonly usersTable: dynamodb.Table;
  public readonly agentTasksTable: dynamodb.Table;

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

    // Users table — stores user profiles
    this.usersTable = new dynamodb.Table(this, "UsersTable", {
      tableName: "openbrain-users",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
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

    new cdk.CfnOutput(this, "AgentTasksTableName", {
      value: this.agentTasksTable.tableName,
      exportName: "BrainAgentTasksTableName",
    });

    new cdk.CfnOutput(this, "AgentKeysTableName", {
      value: this.agentKeysTable.tableName,
      exportName: "BrainAgentKeysTableName",
    });
    new cdk.CfnOutput(this, "UsersTableName", {
      value: this.usersTable.tableName,
      exportName: "BrainUsersTableName",
    });
  }
}
