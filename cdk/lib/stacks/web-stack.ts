import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as path from "path";

interface WebStackProps extends cdk.StackProps {
  /** e.g. "brain.blanxlait.ai" — if set, creates ACM cert + CloudFront alias */
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
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            "/register": {
              origin: apiOrigin,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
              originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
          }
        : {};

    const distribution = new cloudfront.Distribution(this, "WebDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors,
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
