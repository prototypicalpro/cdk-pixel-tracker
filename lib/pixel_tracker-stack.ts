import * as cdk from '@aws-cdk/core'
import * as apigateway from '@aws-cdk/aws-apigateway'
import * as s3 from '@aws-cdk/aws-s3'
import * as iam from '@aws-cdk/aws-iam'
import * as logs from '@aws-cdk/aws-logs'
import * as firehose from '@aws-cdk/aws-kinesisfirehose'

function getTypeOverride (type: string): string {
  return `#set($context.responseOverride.header.Content-Type = "${type}")`
}

export class PixelTrackerStack extends cdk.Stack {
  constructor (scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // create firehose log group
    const fireLogs = new logs.LogGroup(this, 'fire-logs', {
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    // create an S3 bucket for the firehose
    const dataBucket = new s3.Bucket(this, 'datalogs', { removalPolicy: cdk.RemovalPolicy.DESTROY })

    // create a role for the firehose with write access to the bucket
    const dataPolicy = new iam.Role(this, 'firehose-role', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com')
    })
    dataBucket.grantReadWrite(dataPolicy)
    fireLogs.grantWrite(dataPolicy)

    // create a kinesis firehose wired to the destination bucket
    const firehoseName = id + '-datahose'
    const firehoseInstance = new firehose.CfnDeliveryStream(this, 'datahose', {
      deliveryStreamName: firehoseName,
      deliveryStreamType: 'DirectPut',
      s3DestinationConfiguration: {
        bucketArn: dataBucket.bucketArn,
        roleArn: dataPolicy.roleArn,
        compressionFormat: 'GZIP',
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: fireLogs.logGroupName,
          logStreamName: 'firehoselogs'
        }
      }
    })

    // create IAM policy for API gateway
    const apiPolicy = new iam.Role(this, 'api-role', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com')
    })

    // and the firehose instance
    iam.Grant.addToPrincipal({
      grantee: apiPolicy,
      actions: ['firehose:PutRecord'],
      resourceArns: [firehoseInstance.attrArn],
      scope: firehoseInstance
    })

    const DUMP_TEMPLATE =
`#set($allParams = $input.params())
#set($allData = "{
""params"":{
#foreach($type in $allParams.keySet())
  #set($params = $allParams.get($type))
  ""$type"":{
  #foreach($paramName in $params.keySet())
    ""$paramName"":""$util.escapeJavaScript($params.get($paramName))""
    #if($foreach.hasNext),#end
  #end
  }
  #if($foreach.hasNext),#end
#end
},
""context"":{
  ""http-method"":""$context.httpMethod"",
  ""stage"":""$context.stage"",
  ""source-ip"":""$context.identity.sourceIp"",
  ""user-agent"":""$context.identity.userAgent"",
  ""request-id"":""$context.requestId"",
  ""resource-id"":""$context.resourceId"",
  ""resource-path"":""$context.resourcePath""
}")
{
  "DeliveryStreamName":"$stageVariables.firehoseName",
   "Record":{
      "Data":"$util.base64Encode($allData)"
   }
}`.replace(/^(?: |\t)+|\n|\r\n/mg, '')

    const defaultImage = getTypeOverride('image/gif') + '$util.base64Decode("R0lGODlhAQABAIABAAAAAP///yH5BAEAAAEALAAAAAABAAEAAAICTAEAOw==")'
    // configure the API integration to send to the firehose
    const integration = new apigateway.AwsIntegration({
      service: 'firehose',
      action: 'PutRecord',
      integrationHttpMethod: 'POST',
      options: {
        integrationResponses: [{
          statusCode: '200',
          responseTemplates: {
            'application/json': '{"status":"OK"}',
            'image/svg+xml': getTypeOverride('image/svg+xml') + '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
            'image/png': getTypeOverride('image/png') + '$util.base64Decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")',
            'image/jpeg': getTypeOverride('image/jpeg') + '$util.base64Decode("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AfwD/2Q==")',
            'image/gif': defaultImage,
            'image/webp': defaultImage,
            'image/*': defaultImage
          }
        }],
        credentialsRole: apiPolicy,
        requestTemplates: {
          'application/json': DUMP_TEMPLATE
        },
        requestParameters: {
          'integration.request.header.Content-Type': "'application/x-amz-json-1.1'"
        },
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER
      }
    })

    // create the API gateway
    const api = new apigateway.RestApi(this, 'pixel-tracker', {
      cloudWatchRole: true,
      deployOptions: {
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        variables: { firehoseName }
      }
    })

    api.root.addMethod('GET', integration, { methodResponses: [{ statusCode: '200' }] })
  }
}
