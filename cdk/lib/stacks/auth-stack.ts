import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

interface AuthStackProps extends cdk.StackProps {
  googleClientId: string;
  googleClientSecretArn: string;
  callbackUrls?: string[];
  logoutUrls?: string[];
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly webClient: cognito.UserPoolClient;
  public readonly cliClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
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

    // Cognito domain (required for OAuth/social login redirects)
    this.userPoolDomain = this.userPool.addDomain("BrainDomain", {
      cognitoDomain: { domainPrefix: `openbrain-${this.account}` },
    });

    // Google identity provider
    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      "GoogleProvider",
      {
        userPool: this.userPool,
        clientId: props.googleClientId,
        clientSecretValue: cdk.SecretValue.secretsManager(
          props.googleClientSecretArn
        ),
        scopes: ["openid", "email", "profile"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          preferredUsername: cognito.ProviderAttribute.GOOGLE_NAME,
          profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
        },
      }
    );

    const callbackUrls = props.callbackUrls ?? [
      "http://localhost:5173/callback",
    ];
    const logoutUrls = props.logoutUrls ?? ["http://localhost:5173/login"];

    // Web client (browser SPA) — with OAuth for Google sign-in
    this.webClient = this.userPool.addClient("WebClient", {
      userPoolClientName: "brain-web",
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls,
        logoutUrls,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Ensure the client is created after the Google provider
    this.webClient.node.addDependency(googleProvider);

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
    new cdk.CfnOutput(this, "CognitoDomain", {
      value: this.userPoolDomain.baseUrl(),
      exportName: "BrainCognitoDomain",
    });
  }
}
