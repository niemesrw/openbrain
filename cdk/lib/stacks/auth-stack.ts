import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { Construct } from "constructs";

interface AuthStackProps extends cdk.StackProps {
  googleClientId: string;
  googleClientSecretArn: string;
  callbackUrls?: string[];
  logoutUrls?: string[];
  appleClientId?: string;
  appleKeyId?: string;
  applePrivateKeyArn?: string;
  appleTeamId?: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly webClient: cognito.UserPoolClient;
  public readonly cliClient: cognito.UserPoolClient;
  public readonly mobileClient: cognito.UserPoolClient;

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

    // Apple identity provider (optional — only configured when all four credentials are provided)
    const hasApple = props.appleClientId && props.appleKeyId && props.applePrivateKeyArn && props.appleTeamId;
    const appleProvider = hasApple
      ? new cognito.UserPoolIdentityProviderApple(this, "AppleProvider", {
          userPool: this.userPool,
          clientId: props.appleClientId!,
          keyId: props.appleKeyId!,
          privateKey: cdk.SecretValue.secretsManager(props.applePrivateKeyArn!).unsafeUnwrap(),
          teamId: props.appleTeamId!,
          scopes: ["openid", "email", "name"],
          attributeMapping: {
            email: cognito.ProviderAttribute.APPLE_EMAIL,
            preferredUsername: cognito.ProviderAttribute.other("name"),
          },
        })
      : undefined;

    const appleIdp = cognito.UserPoolClientIdentityProvider.APPLE;

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
        ...(hasApple ? [appleIdp] : []),
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

    // Ensure the client is created after the identity providers
    this.webClient.node.addDependency(googleProvider);
    if (appleProvider) this.webClient.node.addDependency(appleProvider);

    // CLI client — longer token lifetime for dev use, with OAuth for Google sign-in
    this.cliClient = this.userPool.addClient("CliClient", {
      userPoolClientName: "brain-cli",
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        ...(hasApple ? [appleIdp] : []),
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ["http://localhost:19836/callback"],
        logoutUrls: ["http://localhost:19836/logout"],
      },
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(90),
    });

    this.cliClient.node.addDependency(googleProvider);
    if (appleProvider) this.cliClient.node.addDependency(appleProvider);

    // Mobile client — for iOS/macOS native apps, uses custom URL scheme
    this.mobileClient = this.userPool.addClient("MobileClient", {
      userPoolClientName: "brain-mobile",
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        ...(hasApple ? [appleIdp] : []),
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ["openbrain://callback"],
        logoutUrls: ["openbrain://logout"],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });
    this.mobileClient.node.addDependency(googleProvider);
    if (appleProvider) this.mobileClient.node.addDependency(appleProvider);

    // Pre-Signup trigger — links federated identities with same email to one user
    const preSignUpFn = new lambdaNode.NodejsFunction(this, "PreSignUpFn", {
      entry: path.join(__dirname, "../../../lambda/src/cognito-pre-signup.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(10),
    });

    preSignUpFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminLinkProviderForUser",
        ],
        resources: [this.userPool.userPoolArn],
      })
    );

    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);

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
    new cdk.CfnOutput(this, "MobileClientId", {
      value: this.mobileClient.userPoolClientId,
      exportName: "BrainMobileClientId",
    });
  }
}
