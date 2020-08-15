import * as cdk from '@aws-cdk/core'
import * as apigateway from '@aws-cdk/aws-apigateway'
import * as s3 from '@aws-cdk/aws-s3'
import * as iam from '@aws-cdk/aws-iam'
import * as firehose from '@aws-cdk/aws-kinesisfirehose'
import * as certmanager from '@aws-cdk/aws-certificatemanager'
import * as route53 from '@aws-cdk/aws-route53'
import * as route53Targets from '@aws-cdk/aws-route53-targets'

function getTypeOverride (type: string): string {
  return `#set($context.responseOverride.header.Content-Type = "${type}")`
}

export class PixelTrackerStack extends cdk.Stack {
  constructor (scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // create an S3 bucket for the firehose
    const dataBucket = new s3.Bucket(this, 'datalogs', { removalPolicy: cdk.RemovalPolicy.DESTROY })

    // create a role for the firehose with write access to the bucket
    const dataPolicy = new iam.Role(this, 'firehose-role', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com')
    })
    dataBucket.grantReadWrite(dataPolicy)

    // create a kinesis firehose wired to the destination bucket
    const firehoseName = id + '-datahose'
    const firehoseInstance = new firehose.CfnDeliveryStream(this, 'datahose', {
      deliveryStreamName: firehoseName,
      deliveryStreamType: 'DirectPut',
      s3DestinationConfiguration: {
        bucketArn: dataBucket.bucketArn,
        roleArn: dataPolicy.roleArn,
        compressionFormat: 'GZIP'
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

    const svgImage = getTypeOverride('image/svg+xml') + '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    // configure the API integration to send to the firehose
    const integration = new apigateway.AwsIntegration({
      service: 'firehose',
      action: 'PutRecord',
      integrationHttpMethod: 'POST',
      options: {
        integrationResponses: [{
          statusCode: '200',
          responseTemplates: {
            'image/svg+xml': svgImage
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
      deployOptions: {
        variables: { firehoseName }
      },
      domainName: {
        certificate: certmanager.Certificate.fromCertificateArn(this, 'global-cert', this.node.tryGetContext('cert-arn')),
        domainName: 'track.prototypical.pro',
        endpointType: apigateway.EndpointType.REGIONAL,
        securityPolicy: apigateway.SecurityPolicy.TLS_1_2
      }
    })

    api.root.addMethod('GET', integration, { methodResponses: [{ statusCode: '200' }] })

    // add records to route53
    const zone = route53.HostedZone.fromHostedZoneId(this, 'prototypicalprozone', this.node.tryGetContext('zone-id'))
    const record = new route53.ARecord(this, 'ATrackRecord', {
      zone,
      target: route53.RecordTarget.fromAlias(new route53Targets.ApiGateway(api)),
      recordName: 'track.prototypical.pro.'
    })
    const v6record = new route53.AaaaRecord(this, 'AnotherTrackRecord', {
      zone,
      target: route53.RecordTarget.fromAlias(new route53Targets.ApiGateway(api)),
      recordName: 'track.prototypical.pro.'
    })
  }
}
