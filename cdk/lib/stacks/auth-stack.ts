import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly webClient: cognito.UserPoolClient;
  public readonly cliClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "BrainUserPool", {
      userPoolName: "enterprise-brain-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        preferredUsername: { required: false, mutable: true },
      },
      customAttributes: {
        team_id: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const readAttributes = new cognito.ClientAttributes()
      .withStandardAttributes({
        email: true,
        emailVerified: true,
        preferredUsername: true,
      })
      .withCustomAttributes("team_id");

    const writeAttributes = new cognito.ClientAttributes()
      .withStandardAttributes({ preferredUsername: true });

    // Web client (browser SPA)
    this.webClient = this.userPool.addClient("WebClient", {
      userPoolClientName: "brain-web",
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      readAttributes,
      writeAttributes,
    });

    // CLI client — longer token lifetime for dev use
    this.cliClient = this.userPool.addClient("CliClient", {
      userPoolClientName: "brain-cli",
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(90),
      readAttributes,
      writeAttributes,
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: "BrainUserPoolId",
    });
    new cdk.CfnOutput(this, "WebClientId", {
      value: this.webClient.userPoolClientId,
      exportName: "BrainWebClientId",
    });
    new cdk.CfnOutput(this, "CliClientId", {
      value: this.cliClient.userPoolClientId,
      exportName: "BrainCliClientId",
    });
  }
}
