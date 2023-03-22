import * as lambdaNodeJs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as cwlogs from 'aws-cdk-lib/aws-logs'
import { Construct } from 'constructs'
interface ECommerceApiStackProps extends cdk.StackProps {
  productsFetchHandler: lambdaNodeJs.NodejsFunction
  productsAdminHandler: lambdaNodeJs.NodejsFunction
  ordersHandler: lambdaNodeJs.NodejsFunction
  orderEventsFetchHandler: lambdaNodeJs.NodejsFunction
}

export class ECommerceApiStack extends cdk.Stack {
  private productsAuthorizer: apigateway.CognitoUserPoolsAuthorizer
  private customerPool: cognito.UserPool
  private adminPool: cognito.UserPool

  constructor(scope: Construct, id: string, props: ECommerceApiStackProps) {
    super(scope, id, props)

    const logGroup = new cwlogs.LogGroup(this, 'ECommerceApiLogs')

    const api = new apigateway.RestApi(this, 'ECommerceApi', {
      restApiName: 'ECommerceApi',
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          caller: true,
          user: true
        })
      }
    })
    this.createCognitoAuth()
    this.createProductsService(props, api)
    this.createOrdersService(props, api)
  }

  private createCognitoAuth() {

    const postConfirmationHandler = new lambdaNodeJs.NodejsFunction(this, 'PostConfirmationFunction', {
      functionName: 'PostConfirmationFunction',
      entry: 'lambda/auth/postConfirmationFunction.ts',
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      tracing: lambda.Tracing.ACTIVE,
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })

    const preAuthenticationHandler = new lambdaNodeJs.NodejsFunction(this, 'PreAuthenticatioFunction', {
      functionName: 'PreAuthenticatioFunction',
      entry: 'lambda/auth/preAuthenticationFunction.ts',
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      tracing: lambda.Tracing.ACTIVE,
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })


    //Cognito customer UserPool
    this.customerPool = new cognito.UserPool(this, 'CustomerPool', {
      lambdaTriggers: {
        preAuthentication: preAuthenticationHandler,
        postConfirmation: postConfirmationHandler
      },
      userPoolName: 'CustomerPool',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
        phone: false
      },
      userVerification: {
        emailSubject: 'Verify your email for the Ecommerce service!',
        emailBody: 'Thanks for signing up to Ecommerce service! Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE
      },
      signInAliases: {
        username: false,
        email: true
      },
      standardAttributes: {
        fullname: {
          required: true,
          mutable: false
        }
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3)
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY
    })

    this.customerPool.addDomain('CustomerDomain', {
      cognitoDomain: {
        domainPrefix: 'ecs-customer-service'
      }
    })

    const customerWebScope = new cognito.ResourceServerScope({
      scopeName: 'web',
      scopeDescription: 'Customer web operation'
    })

    const customerMobileScope = new cognito.ResourceServerScope({
      scopeName: 'mobile',
      scopeDescription: 'Customer mobile operations'
    })

    const customerResourceServer = this.customerPool.addResourceServer('CustomerResourceServer', {
      identifier: 'customer',
      userPoolResourceServerName: 'CustomerResourceServer',
      scopes: [customerMobileScope, customerWebScope]
    })

    this.customerPool.addClient('customer-web-client', {
      userPoolClientName: 'customerWebClient',
      authFlows: {
        userPassword: true
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [cognito.OAuthScope.resourceServer(customerResourceServer, customerWebScope)]
      }
    })

    this.customerPool.addClient('customer-mobile-client', {
      userPoolClientName: 'customerMobileClient',
      authFlows: {
        userPassword: true
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [cognito.OAuthScope.resourceServer(customerResourceServer, customerMobileScope)]
      }
    })

    this.productsAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ProductsAuthorizer', {
      authorizerName: 'ProductsAuthorizer',
      cognitoUserPools: [this.customerPool]
    })
  }

  private createOrdersService(props: ECommerceApiStackProps, api: apigateway.RestApi) {
    const ordersIntegration = new apigateway.LambdaIntegration(props.ordersHandler)

    const ordersResource = api.root.addResource('orders')
    // '/orders'
    // GET /orders
    // GET /orders?email=mail@mail.com
    // GET /orders?email=mail@mail.com&orderId=123
    ordersResource.addMethod('GET', ordersIntegration)

    const orderDeleteValidator = new apigateway.RequestValidator(this, 'OrderDeletionValidator', {
      restApi: api,
      requestValidatorName: 'OrderDeletionValidator',
      validateRequestParameters: true
    })
    // DELETE /orders?email=mail@mail.com&orderId=123
    ordersResource.addMethod('DELETE', ordersIntegration, {
      requestParameters: {
        'method.request.querystring.email': true,
        'method.request.querystring.orderId': true
      },
      requestValidator: orderDeleteValidator
    })

    // POST /orders
    const orderRequestValidator = new apigateway.RequestValidator(this, 'OrderRequestValidator', {
      restApi: api,
      requestValidatorName: 'Order request validator',
      validateRequestBody: true
    })

    const orderModel = new apigateway.Model(this, 'Order Model', {
      modelName: 'OrderModel',
      restApi: api,
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          email: {
            type: apigateway.JsonSchemaType.STRING
          },
          productIds: {
            type: apigateway.JsonSchemaType.ARRAY,
            minItems: 1,
            items: {
              type: apigateway.JsonSchemaType.STRING
            }
          },
          payment: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ['CASH', 'DEBIT_CARD', 'CREDIT_CARD']
          }
        },
        required: [
          'email',
          'productIds',
          'payment'
        ]
      }
    })

    ordersResource.addMethod('POST', ordersIntegration, {
      requestValidator: orderRequestValidator,
      requestModels: {
        'application/json': orderModel
      }
    })
    const orderEventsResource = ordersResource.addResource("events")
    const orderEventsFetchValidator = new apigateway.RequestValidator(this, "OrderEventsFetchValidator", {
      restApi: api,
      requestValidatorName: "OrderEventsFetchValidator",
      validateRequestParameters: true
    })

    const orderEventsFunctionIntegration = new apigateway.LambdaIntegration(props.orderEventsFetchHandler)
    //GET /orders/events?email=mail@mail.com.br
    //GET /orders/events?email=mail@mail.com.br&eventType=ORDER_CREATED

    orderEventsResource.addMethod('GET', orderEventsFunctionIntegration, {
      requestParameters: {
        'method.request.querystring.email': true,
        'method.request.querystring.eventType': false
      },
      requestValidator: orderEventsFetchValidator
    })
  }

  private createProductsService(props: ECommerceApiStackProps, api: apigateway.RestApi) {
    const productsFetchIntegration = new apigateway.LambdaIntegration(props.productsFetchHandler)

    const productsFetchWebMobileIntegrationOption = {
      authorizer: this.productsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ['customer/web', 'customer/mobile']
    }

    const productsFetchWebIntegrationOption = {
      authorizer: this.productsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ['customer/web']
    }
    // '/products'
    const productsResource = api.root.addResource('products')
    productsResource.addMethod('GET', productsFetchIntegration, productsFetchWebMobileIntegrationOption)

    // /products/{id}
    const productIdResource = productsResource.addResource('{id}')
    productIdResource.addMethod('GET', productsFetchIntegration, productsFetchWebIntegrationOption)

    const productsAdminIntegration = new apigateway.LambdaIntegration(props.productsAdminHandler)

    // '/products'
    const productRequestValidator = new apigateway.RequestValidator(this, 'ProductRequestValidator', {
      restApi: api,
      requestValidatorName: 'Product request validator',
      validateRequestBody: true
    })

    const productModel = new apigateway.Model(this, 'Product Model', {
      modelName: 'ProductModel',
      restApi: api,
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          productName: {
            type: apigateway.JsonSchemaType.STRING
          },
          code: {
            type: apigateway.JsonSchemaType.STRING
          },
          model: {
            type: apigateway.JsonSchemaType.STRING
          },
          productUrl: {
            type: apigateway.JsonSchemaType.STRING
          },
          price: {
            type: apigateway.JsonSchemaType.NUMBER
          }
        },
        required: [
          'productName',
          'code'
        ]
      }
    })

    productsResource.addMethod('POST', productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        'application/json': productModel
      }
    })

    // '/products/{id}'
    productIdResource.addMethod('PUT', productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        'application/json': productModel
      }
    })

    // '/products/{id}'
    productIdResource.addMethod('DELETE', productsAdminIntegration)
  }
}