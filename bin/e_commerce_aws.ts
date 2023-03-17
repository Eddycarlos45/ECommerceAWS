#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ProductsAppStack } from '../lib/productsApp-stack'
import { ECommerceApiStack } from '../lib/ecommerceApi-stack'
import { ProductsAppLayersStack } from '../lib/productsAppLayers-stack'
import { EventsDdbStack } from '../lib/eventsDdb-stack'
import { OrdersAppLayersStack } from '../lib/ordersAppLayers-stack';
import { OrdersAppStack } from '../lib/ordersApp-stack';
import { InvoiceWsApiStack } from '../lib/invoiceWSApi-stack'
import { InvoicesAppLayersStack } from '../lib/invoicesAppLayers-stack'
import { AuditEventBusStack } from '../lib/auditEventBus-stack'

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.AWS_ACCOUNT,
  region: process.env.AWS_REGION
}

const tags = {
  cost: 'ECommerce',
  team: 'EdsonSousa'
}

const auditEventBus = new AuditEventBusStack(app, 'AuditEvents', {
  tags: {
    cost: 'Audit',
    team: 'EdsonSousa'
  },
  env: env
})
const productsAppLayersStack = new ProductsAppLayersStack(app, 'ProductsAppLayers', {
  tags: tags,
  env: env
})

const eventsDdbStack = new EventsDdbStack(app, 'EventsDdb', {
  tags: tags,
  env: env
})

const productsAppStack = new ProductsAppStack(app, 'ProductsApp', {
  eventsDdb: eventsDdbStack.table,
  tags: tags,
  env: env
})

productsAppStack.addDependency(productsAppLayersStack)
productsAppStack.addDependency(eventsDdbStack)

const ordersAppLayersStack = new OrdersAppLayersStack(app, 'OrdersAppLayers', {
  tags: tags,
  env: env
})

const ordersAppStack = new OrdersAppStack(app, 'OrdersApp', {
  tags: tags,
  env: env,
  productsDdb: productsAppStack.productsDdb,
  eventsDdb: eventsDdbStack.table,
  auditBus: auditEventBus.bus
})

ordersAppStack.addDependency(productsAppStack)
ordersAppStack.addDependency(ordersAppLayersStack)
ordersAppStack.addDependency(eventsDdbStack)
ordersAppStack.addDependency(auditEventBus)

const eCommerceApiStack = new ECommerceApiStack(app, 'ECommerceApi', {
  productsFetchHandler: productsAppStack.productsFetchHandler,
  productsAdminHandler: productsAppStack.productsAdminHandler,
  ordersHandler: ordersAppStack.ordersHandler,
  orderEventsFetchHandler: ordersAppStack.orderEventFetchHandler,
  tags: tags,
  env: env
})

eCommerceApiStack.addDependency(productsAppStack)
eCommerceApiStack.addDependency(ordersAppStack)

const invoicesAppLayersStack = new InvoicesAppLayersStack(app, 'InvoicesAppLayer', {
  tags: {
    const: 'InvoiceAPP',
    team: 'EdsonSousa'
  },
  env: env
})

const invoiceWSApiStack = new InvoiceWsApiStack(app, 'InvoiceApi', {
  eventsDdb: eventsDdbStack.table,
  auditBus: auditEventBus.bus,
  tags: {
    const: 'InvoiceApp',
    team: 'EdsonSousa'
  },
  env: env
})

invoiceWSApiStack.addDependency(invoicesAppLayersStack)
invoiceWSApiStack.addDependency(eventsDdbStack)
invoiceWSApiStack.addDependency(auditEventBus)
