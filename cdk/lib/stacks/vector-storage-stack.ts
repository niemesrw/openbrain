import * as cdk from "aws-cdk-lib";
import * as customResources from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

// AWS::S3Vectors::VectorBucket and AWS::S3Vectors::VectorIndex are not yet
// supported as native CloudFormation resource types. We use AwsCustomResource
// (SDK-backed Lambda) to manage their lifecycle through CloudFormation until
// native support lands.

export class VectorStorageStack extends cdk.Stack {
  public readonly vectorBucketName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vectorBucketName = "open-brain-vectors";

    // installLatestAwsSdk is required: @aws-sdk/client-s3vectors is not
    // included in the default Lambda runtime bundle.
    const sdkPolicy = customResources.AwsCustomResourcePolicy.fromSdkCalls({
      resources: customResources.AwsCustomResourcePolicy.ANY_RESOURCE,
    });

    const vectorBucket = new customResources.AwsCustomResource(
      this,
      "VectorBucket",
      {
        installLatestAwsSdk: true,
        onUpdate: {
          service: "S3Vectors",
          action: "CreateVectorBucket",
          parameters: { vectorBucketName: this.vectorBucketName },
          physicalResourceId: customResources.PhysicalResourceId.of(
            this.vectorBucketName
          ),
          ignoreErrorCodesMatching: "ConflictException",
        },
        // No onDelete — retain the bucket and its data on stack teardown.
        policy: sdkPolicy,
      }
    );

    const sharedIndex = new customResources.AwsCustomResource(
      this,
      "SharedIndex",
      {
        installLatestAwsSdk: true,
        onUpdate: {
          service: "S3Vectors",
          action: "CreateIndex",
          parameters: {
            vectorBucketName: this.vectorBucketName,
            indexName: "shared",
            dataType: "float32",
            dimension: 1024,
            distanceMetric: "cosine",
            metadataConfiguration: {
              nonFilterableMetadataKeys: [
                "content",
                "action_items",
                "dates_mentioned",
              ],
            },
          },
          physicalResourceId: customResources.PhysicalResourceId.of(
            `${this.vectorBucketName}/shared`
          ),
          ignoreErrorCodesMatching: "ConflictException",
        },
        policy: sdkPolicy,
      }
    );
    sharedIndex.node.addDependency(vectorBucket);

    new cdk.CfnOutput(this, "VectorBucketName", {
      value: this.vectorBucketName,
      exportName: "BrainVectorBucketName",
    });
  }
}
