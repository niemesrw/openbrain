import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import * as path from "path";

interface WebStackProps extends cdk.StackProps {
  /** e.g. "brain.your-domain.com" — if set, creates ACM cert + CloudFront alias */
  customDomain?: string;
  /** Hostname of the API Gateway endpoint (no protocol), used to proxy /mcp and /chat */
  apiEndpointHostname?: string;
}

export class WebStack extends cdk.Stack {
  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props: WebStackProps = {}) {
    super(scope, id, props);

    const { customDomain, apiEndpointHostname } = props;

    // Fail fast: apiEndpointHostname is required when customDomain is set
    if (customDomain && !apiEndpointHostname) {
      throw new Error(
        `WebStack: customDomain "${customDomain}" was provided but apiEndpointHostname is missing. ` +
        "Pass apiEndpointHostname so /mcp and /chat path behaviors can be wired to API Gateway."
      );
    }

    // ACM certificate must be in us-east-1 for CloudFront
    if (customDomain && this.region !== "us-east-1") {
      throw new Error(
        `WebStack: ACM certificates for CloudFront must be in us-east-1, but this stack is being deployed to ${this.region}. ` +
        "Deploy this stack with env.region = 'us-east-1'."
      );
    }

    const bucket = new s3.Bucket(this, "WebBucket", {
      bucketName: `openbrain-web-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ACM certificate (must be us-east-1 for CloudFront)
    const certificate =
      customDomain
        ? new acm.Certificate(this, "WebCert", {
            domainName: customDomain,
            validation: acm.CertificateValidation.fromDns(),
          })
        : undefined;

    // API Gateway origin for /mcp and /chat path behaviors
    const apiOrigin =
      customDomain && apiEndpointHostname
        ? new origins.HttpOrigin(apiEndpointHostname, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          })
        : undefined;

    // Additional CloudFront behaviors for API paths (only when custom domain + API origin configured)
    // Use managed CachingDisabled + AllViewerExceptHostHeader to forward all headers
    // (including Authorization and x-api-key) with no caching.
    // Custom CachePolicy with headerBehavior is invalid when TTL=0.
    const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> =
      apiOrigin
        ? {
            "/mcp*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/chat*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/.well-known/*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/oauth/*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/llms.txt": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
              cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/register": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/auth/*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/brain/*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/github*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/agent*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/insight*": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
          }
        : {};

    // -------------------------------------------------------------------------
    // Security headers — applied to the SPA default behavior only.
    // API proxy behaviors are intentionally excluded so API Gateway can set its
    // own response headers without conflict.
    //
    // CSP notes:
    //   - style-src needs 'unsafe-inline' because React renders inline style={} attrs
    //   - connect-src: when a custom domain is configured all API/chat paths are proxied
    //     through this CloudFront distribution, so 'self' covers them. Cognito requires
    //     two explicit entries: *.amazoncognito.com (hosted UI / token endpoint) AND
    //     cognito-idp.<region>.amazonaws.com (IDP API used by Amplify for token refresh).
    //     Without a custom domain the SPA calls API Gateway and Lambda URLs directly.
    //   - img-src allows https: + data: for og:image enrichment and any base64 thumbs
    // -------------------------------------------------------------------------
    const connectSrc = apiOrigin
      // API paths are proxied by this distribution → 'self' covers all API/chat calls
      ? `connect-src 'self' https://*.amazoncognito.com https://cognito-idp.${this.region}.amazonaws.com`
      // No proxy configured: SPA calls API Gateway and Lambda URLs directly
      : `connect-src 'self' https://*.amazoncognito.com https://cognito-idp.${this.region}.amazonaws.com https://*.execute-api.${this.region}.amazonaws.com https://*.lambda-url.${this.region}.on.aws`;

    const cspValue = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      connectSrc,
      "img-src 'self' https: data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      `form-action 'self' https://*.amazoncognito.com`,
      "upgrade-insecure-requests",
    ].join("; ");

    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      responseHeadersPolicyName: `openbrain-security-headers-${this.account}`,
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: cspValue,
          override: true,
        },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        contentTypeOptions: { override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(730),
          includeSubdomains: true,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    // -------------------------------------------------------------------------
    // CloudFront WAF — CommonRuleSet (scoped) + KnownBadInputs + IP reputation.
    // WAFv2 AssociateWebACL does not support HTTP API v2 stages, so this is the
    // only WAF layer. CommonRuleSet is scoped to exclude /mcp and /chat because
    // those paths accept large user-controlled natural-language payloads that
    // reliably trigger SQLi/XSS rules as false positives. KnownBadInputs and IP
    // reputation still apply to all paths including /mcp and /chat.
    // CloudFront-scope WAFs must be deployed in us-east-1.
    // -------------------------------------------------------------------------
    const cloudFrontWaf = this.region === "us-east-1"
      ? new wafv2.CfnWebACL(this, "WebWaf", {
          name: `${this.stackName}-${this.account}-web-waf`,
          scope: "CLOUDFRONT",
          defaultAction: { allow: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "OpenBrainWebWaf",
            sampledRequestsEnabled: true,
          },
          rules: [
            {
              // Scoped to exclude POST /mcp and POST /chat — those paths accept
              // large user-controlled payloads that trigger false positives.
              // GET /mcp is an unauthenticated health check with no body, so it
              // is NOT excluded and remains covered by CommonRuleSet.
              name: "AWSManagedRulesCommonRuleSet",
              priority: 1,
              overrideAction: { none: {} },
              statement: {
                managedRuleGroupStatement: {
                  vendorName: "AWS",
                  name: "AWSManagedRulesCommonRuleSet",
                  scopeDownStatement: {
                    notStatement: {
                      statement: {
                        orStatement: {
                          statements: [
                            {
                              // POST /mcp — carries large JSON-RPC payloads
                              andStatement: {
                                statements: [
                                  {
                                    byteMatchStatement: {
                                      fieldToMatch: { uriPath: {} },
                                      positionalConstraint: "STARTS_WITH",
                                      searchString: "/mcp",
                                      textTransformations: [{ priority: 0, type: "NONE" }],
                                    },
                                  },
                                  {
                                    byteMatchStatement: {
                                      fieldToMatch: { method: {} },
                                      positionalConstraint: "EXACTLY",
                                      searchString: "POST",
                                      textTransformations: [{ priority: 0, type: "NONE" }],
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              // POST /chat — carries large natural-language payloads
                              andStatement: {
                                statements: [
                                  {
                                    byteMatchStatement: {
                                      fieldToMatch: { uriPath: {} },
                                      positionalConstraint: "STARTS_WITH",
                                      searchString: "/chat",
                                      textTransformations: [{ priority: 0, type: "NONE" }],
                                    },
                                  },
                                  {
                                    byteMatchStatement: {
                                      fieldToMatch: { method: {} },
                                      positionalConstraint: "EXACTLY",
                                      searchString: "POST",
                                      textTransformations: [{ priority: 0, type: "NONE" }],
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: "WebCommonRuleSet",
                sampledRequestsEnabled: true,
              },
            },
            {
              name: "AWSManagedRulesKnownBadInputsRuleSet",
              priority: 2,
              overrideAction: { none: {} },
              statement: {
                managedRuleGroupStatement: {
                  vendorName: "AWS",
                  name: "AWSManagedRulesKnownBadInputsRuleSet",
                },
              },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: "WebKnownBadInputs",
                sampledRequestsEnabled: true,
              },
            },
            {
              name: "AWSManagedRulesAmazonIpReputationList",
              priority: 3,
              overrideAction: { none: {} },
              statement: {
                managedRuleGroupStatement: {
                  vendorName: "AWS",
                  name: "AWSManagedRulesAmazonIpReputationList",
                },
              },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: "WebIpReputation",
                sampledRequestsEnabled: true,
              },
            },
            // Rate-limit unauthenticated paths useful for reconnaissance/abuse:
            // /register (DCR), /oauth/ (auth proxy), /.well-known/ (discovery).
            // 300 requests per 5-minute window per IP ≈ 60 req/min.
            {
              name: "RateLimitUnauthenticatedPaths",
              priority: 4,
              action: { block: {} },
              statement: {
                rateBasedStatement: {
                  limit: 300,
                  evaluationWindowSec: 300,
                  aggregateKeyType: "IP",
                  scopeDownStatement: {
                    orStatement: {
                      statements: [
                        {
                          byteMatchStatement: {
                            fieldToMatch: { uriPath: {} },
                            positionalConstraint: "EXACTLY",
                            searchString: "/register",
                            textTransformations: [{ priority: 0, type: "NONE" }],
                          },
                        },
                        {
                          byteMatchStatement: {
                            fieldToMatch: { uriPath: {} },
                            positionalConstraint: "STARTS_WITH",
                            searchString: "/oauth/",
                            textTransformations: [{ priority: 0, type: "NONE" }],
                          },
                        },
                        {
                          byteMatchStatement: {
                            fieldToMatch: { uriPath: {} },
                            positionalConstraint: "STARTS_WITH",
                            searchString: "/.well-known/",
                            textTransformations: [{ priority: 0, type: "NONE" }],
                          },
                        },
                      ],
                    },
                  },
                },
              },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: "WebRateLimitUnauthenticated",
                sampledRequestsEnabled: true,
              },
            },
          ],
        })
      : undefined;

    const distribution = new cloudfront.Distribution(this, "WebDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeadersPolicy,
      },
      additionalBehaviors,
      webAclId: cloudFrontWaf?.attrArn,
      domainNames: certificate ? [customDomain!] : undefined,
      certificate,
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });

    new s3deploy.BucketDeployment(this, "DeployWeb", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "..", "..", "..", "web", "dist")),
      ],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
    });

    this.distributionUrl = certificate
      ? `https://${customDomain}`
      : `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, "WebUrl", {
      value: this.distributionUrl,
      exportName: "BrainWebUrl",
    });

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
      description: customDomain
        ? `Add a CNAME record in Cloudflare: ${customDomain} → this value`
        : "CloudFront distribution domain name",
    });

    if (certificate) {
      new cdk.CfnOutput(this, "CertificateArn", {
        value: certificate.certificateArn,
        description: "Check ACM console for DNS validation CNAME records to add in Cloudflare",
      });
    }
  }
}
