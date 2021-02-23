/*
 * © 2020 ThoughtWorks, Inc. All rights reserved.
 */

import AWSMock from 'aws-sdk-mock'
import AWS, { CloudWatch, CloudWatchLogs, CostExplorer, Athena as AWSAthena } from 'aws-sdk'
import CostAndUsageReports from '@services/aws/CostAndUsageReports'
import ComputeEstimator from '@domain/ComputeEstimator'
import { StorageEstimator } from '@domain/StorageEstimator'
import { CLOUD_CONSTANTS } from '@domain/FootprintEstimationConstants'
import { GetQueryExecutionOutput, GetQueryResultsOutput } from 'aws-sdk/clients/athena'
import { EstimationResult } from '@application/EstimationResult'
import config from '@application/ConfigLoader'
import {
  athenaMockGetQueryResultsWithEC2EBSLambda,
  athenaMockGetQueryResultsWithNetworkingGlueECSDynamoDB,
  athenaMockGetQueryResultsWithS3CloudWatchRDS,
  athenaMockGetQueryResultsWithKenesisESAndEc2Spot,
  athenaMockGetQueryResultsWithECSEksKafkaAndUnknownServices,
  athenaMockGetQueryResultsWithDocDBComputeEbsOptimizedSpotUsage,
  athenaMockGetQueryResultsWithRedshiftStorageComputeSavingsPlan,
} from '../../../fixtures/athena.fixtures'
import { ServiceWrapper } from '@services/aws/ServiceWrapper'

jest.mock('@application/ConfigLoader')

describe('CostAndUsageReports Service', () => {
  const startDate = new Date('2020-10-01')
  const endDate = new Date('2020-11-03')

  const startQueryExecutionResponse = { QueryExecutionId: 'some-execution-id' }
  const getQueryExecutionResponse = { QueryExecution: { Status: { State: 'SUCCEEDED' } } }
  const getQueryExecutionFailedResponse = { QueryExecution: { Status: { State: 'FAILED', StateChangeReason: 'TEST' } } }
  const getServiceWrapper = () =>
    new ServiceWrapper(new CloudWatch(), new CloudWatchLogs(), new CostExplorer(), new AWSAthena())

  beforeAll(() => {
    AWSMock.setSDKInstance(AWS)
  })

  beforeEach(() => {
    ;(config as jest.Mock).mockReturnValue({
      AWS: {
        ATHENA_DB_NAME: 'test-db',
        ATHENA_DB_TABLE: 'test-table',
        ATHENA_QUERY_RESULT_LOCATION: 'test-location',
        ATHENA_REGION: 'test-region',
      },
    })
  })

  afterEach(() => {
    AWSMock.restore()
    jest.restoreAllMocks()
    startQueryExecutionSpy.mockClear()
    getQueryExecutionSpy.mockClear()
    getQueryResultsSpy.mockClear()
  })

  it('Gets Estimates for ec2, ebs Snapshot, ebs SDD Storage and lambda across multiple days with accumulation', async () => {
    // given
    mockStartQueryExecution(startQueryExecutionResponse)
    mockGetQueryExecution(getQueryExecutionResponse)
    mockGetQueryResults(athenaMockGetQueryResultsWithEC2EBSLambda)

    // when
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    const result = await athenaService.getEstimates(startDate, endDate)

    expect(startQueryExecutionSpy).toHaveBeenCalledWith(
      {
        QueryString: expect.anything(),
        QueryExecutionContext: {
          Database: 'test-db',
        },
        ResultConfiguration: {
          EncryptionConfiguration: {
            EncryptionOption: 'SSE_S3',
          },
          OutputLocation: 'test-location',
        },
      },
      expect.anything(),
    )

    expect(getQueryExecutionSpy).toHaveBeenCalledWith(startQueryExecutionResponse, expect.anything())
    expect(getQueryResultsSpy).toHaveBeenCalledWith(startQueryExecutionResponse, expect.anything())

    // then

    const expectedResult: EstimationResult[] = [
      {
        timestamp: new Date('2020-11-02'),
        serviceEstimates: [
          {
            wattHours: 1.9632,
            co2e: 0.0000008922744,
            usesAverageCPUConstant: true,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonEC2',
            cost: 3,
            region: 'us-east-1',
          },
          {
            wattHours: 0.9816,
            co2e: 4.66363068e-7,
            usesAverageCPUConstant: true,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonEC2',
            cost: 3,
            region: 'us-east-2',
          },
        ],
      },
      {
        timestamp: new Date('2020-11-03'),
        serviceEstimates: [
          {
            wattHours: 0.9816,
            co2e: 4.66363068e-7,
            usesAverageCPUConstant: true,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonEC2',
            cost: 4,
            region: 'us-east-2',
          },
        ],
      },
      {
        timestamp: new Date('2020-10-29'),
        serviceEstimates: [
          {
            wattHours: 3.2140800000000005,
            co2e: 0.0000014607993600000003,
            usesAverageCPUConstant: false,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonEC2',
            cost: 5,
            region: 'us-east-1',
          },
        ],
      },
      {
        timestamp: new Date('2020-10-30'),
        serviceEstimates: [
          {
            wattHours: 2.9016,
            co2e: 0.0000010200081528,
            usesAverageCPUConstant: false,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonEC2',
            cost: 6,
            region: 'us-west-1',
          },
          {
            wattHours: 0.013633333333333334,
            co2e: 4.792566566666667e-9,
            usesAverageCPUConstant: true,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AWSLambda',
            cost: 15,
            region: 'us-west-1',
          },
        ],
      },
    ]

    expect(result).toEqual(expectedResult)
  })

  it('Gets Estimates for CloudWatch, RDS and S3 all on the same day with accumulation', async () => {
    // given
    mockStartQueryExecution(startQueryExecutionResponse)
    mockGetQueryExecution(getQueryExecutionResponse)
    mockGetQueryResults(athenaMockGetQueryResultsWithS3CloudWatchRDS)

    // when
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    const result = await athenaService.getEstimates(startDate, endDate)

    const expectedResult: EstimationResult[] = [
      {
        timestamp: new Date('2020-10-30'),
        serviceEstimates: [
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 4.987591455574148e-19,
            cost: 9,
            region: 'us-west-1',
            serviceName: 'AmazonS3',
            usesAverageCPUConstant: false,
            wattHours: 1.418811734765768e-12,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 1.3481690984917804e-18,
            cost: 10,
            region: 'us-east-2',
            serviceName: 'AmazonCloudWatch',
            usesAverageCPUConstant: false,
            wattHours: 2.837623469531536e-12,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.0000013187772,
            cost: 11,
            region: 'us-east-1',
            serviceName: 'AmazonRDS',
            usesAverageCPUConstant: false,
            wattHours: 2.9016,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.0000022281567672000002,
            cost: 25,
            region: 'us-west-1',
            serviceName: 'AmazonRDS',
            usesAverageCPUConstant: true,
            wattHours: 6.338400000000001,
          },
        ],
      },
    ]
    expect(result).toEqual(expectedResult)
  })

  it('Gets Estimates for Amazon Glue, ECS and DynamoDB Storage and Ignores Nat-Gateway', async () => {
    // given
    mockStartQueryExecution(startQueryExecutionResponse)
    mockGetQueryExecution(getQueryExecutionResponse)
    mockGetQueryResults(athenaMockGetQueryResultsWithNetworkingGlueECSDynamoDB)

    // when
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    const result = await athenaService.getEstimates(startDate, endDate)

    const expectedResult: EstimationResult[] = [
      {
        timestamp: new Date('2020-10-30'),
        serviceEstimates: [
          {
            wattHours: 19.631999999999998,
            co2e: 0.000008922743999999999,
            usesAverageCPUConstant: true,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AWSGlue',
            cost: 5,
            region: 'us-east-1',
          },
        ],
      },
      {
        timestamp: new Date('2020-10-31'),
        serviceEstimates: [
          {
            wattHours: 0.00709405867382884,
            co2e: 2.493795727787074e-9,
            usesAverageCPUConstant: false,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonDynamoDB',
            cost: 13,
            region: 'us-west-1',
          },
        ],
      },
    ]
    expect(result).toEqual(expectedResult)
  })

  it('Gets Estimates for Kinesis, ES & EC2 Spot Instance', async () => {
    // given
    mockStartQueryExecution(startQueryExecutionResponse)
    mockGetQueryExecution(getQueryExecutionResponse)
    mockGetQueryResults(athenaMockGetQueryResultsWithKenesisESAndEc2Spot)

    // when
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    const result = await athenaService.getEstimates(startDate, endDate)

    const expectedResult: EstimationResult[] = [
      {
        timestamp: new Date('2020-10-30'),
        serviceEstimates: [
          {
            wattHours: 8.258400000000002,
            co2e: 0.000003923607132,
            usesAverageCPUConstant: false,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonKinesisAnalytics',
            cost: 912,
            region: 'us-east-2',
          },
          {
            wattHours: 39.640319999999996,
            co2e: 0.000013934880610559998,
            usesAverageCPUConstant: false,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonES',
            cost: 73,
            region: 'us-west-1',
          },
        ],
      },
      {
        timestamp: new Date('2020-10-31'),
        serviceEstimates: [
          {
            wattHours: 530.064,
            co2e: 0.00024091408799999998,
            usesAverageCPUConstant: true,
            cloudProvider: 'AWS',
            accountName: '123456789',
            serviceName: 'AmazonEC2',
            cost: 10,
            region: 'us-east-1',
          },
        ],
      },
    ]
    expect(result).toEqual(expectedResult)
  })

  it('Gets Estimates for ECS Compute + Storage, EKS Compute, Kafka and Unknown Services', async () => {
    // given
    mockStartQueryExecution(startQueryExecutionResponse)
    mockGetQueryExecution(getQueryExecutionResponse)
    mockGetQueryResults(athenaMockGetQueryResultsWithECSEksKafkaAndUnknownServices)

    // when
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    const result = await athenaService.getEstimates(startDate, endDate)

    const expectedResult: EstimationResult[] = [
      {
        timestamp: new Date('2020-10-30'),
        serviceEstimates: [
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 7.525663199999998e-9,
            cost: 2,
            region: 'us-east-2',
            serviceName: 'AmazonECS',
            usesAverageCPUConstant: false,
            wattHours: 0.015839999999999996,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.00000431330991,
            cost: 2,
            region: 'us-west-1',
            serviceName: 'AmazonECS',
            usesAverageCPUConstant: true,
            wattHours: 12.27,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.000012077267747999998,
            cost: 4,
            region: 'us-west-1',
            serviceName: 'AmazonMSK',
            usesAverageCPUConstant: true,
            wattHours: 34.355999999999995,
          },
        ],
      },
    ]
    expect(result).toEqual(expectedResult)
  })

  it('Gets Estimates for DocumentDB Compute, ElasticMapReduce, EC2 Credits', async () => {
    // given
    mockStartQueryExecution(startQueryExecutionResponse)
    mockGetQueryExecution(getQueryExecutionResponse)
    mockGetQueryResults(athenaMockGetQueryResultsWithDocDBComputeEbsOptimizedSpotUsage)

    // when
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    const result = await athenaService.getEstimates(startDate, endDate)

    const expectedResult: EstimationResult[] = [
      {
        timestamp: new Date('2020-10-30'),
        serviceEstimates: [
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.00005175971891999999,
            cost: 10,
            region: 'us-west-1',
            serviceName: 'AmazonDocDB',
            usesAverageCPUConstant: true,
            wattHours: 147.23999999999998,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.0005244984850560001,
            cost: 30,
            region: 'us-west-1',
            serviceName: 'AmazonEC2',
            usesAverageCPUConstant: true,
            wattHours: 1492.0320000000002,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.000020703887567999997,
            cost: 20,
            region: 'us-west-1',
            serviceName: 'ElasticMapReduce',
            usesAverageCPUConstant: true,
            wattHours: 58.895999999999994,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.000007807400999999999,
            cost: 20,
            region: 'us-east-1',
            serviceName: 'AmazonEC2',
            usesAverageCPUConstant: true,
            wattHours: 17.177999999999997,
          },
        ],
      },
    ]
    expect(result).toEqual(expectedResult)
  })

  it('Gets Estimates for Redshift Storage and Compute, and Savings Plan Compute', async () => {
    // given
    mockStartQueryExecution(startQueryExecutionResponse)
    mockGetQueryExecution(getQueryExecutionResponse)
    mockGetQueryResults(athenaMockGetQueryResultsWithRedshiftStorageComputeSavingsPlan)

    // when
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    const result = await athenaService.getEstimates(startDate, endDate)

    const expectedResult: EstimationResult[] = [
      {
        timestamp: new Date('2020-10-30'),
        serviceEstimates: [
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.0000024346656000000003,
            cost: 10,
            region: 'us-east-1',
            serviceName: 'AmazonRedshift',
            usesAverageCPUConstant: false,
            wattHours: 5.356800000000001,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 2.87553994e-8,
            cost: 10,
            region: 'us-west-1',
            serviceName: 'AmazonRedshift',
            usesAverageCPUConstant: true,
            wattHours: 0.0818,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.00048585122826240006,
            cost: 15,
            region: 'us-west-1',
            serviceName: 'AmazonEC2',
            usesAverageCPUConstant: true,
            wattHours: 1382.0928000000001,
          },
          {
            accountName: '123456789',
            cloudProvider: 'AWS',
            co2e: 0.000006901295856,
            cost: 15,
            region: 'us-west-1',
            serviceName: 'AmazonRDS',
            usesAverageCPUConstant: true,
            wattHours: 19.631999999999998,
          },
        ],
      },
    ]
    expect(result).toEqual(expectedResult)
  })

  it('throws an error when the query status fails', async () => {
    mockStartQueryExecution(startQueryExecutionResponse)
    mockGetQueryExecution(getQueryExecutionFailedResponse)
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    await expect(() => athenaService.getEstimates(startDate, endDate)).rejects.toThrow(
      `Athena query failed. Reason TEST. Query ID: some-execution-id`,
    )
  })

  it('throws an error when the query start fail', async () => {
    mockStartQueryExecutionFailed('Start failed')
    const athenaService = new CostAndUsageReports(
      new ComputeEstimator(),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.SSDCOEFFICIENT),
      new StorageEstimator(CLOUD_CONSTANTS.AWS.HDDCOEFFICIENT),
      getServiceWrapper(),
    )
    await expect(() => athenaService.getEstimates(startDate, endDate)).rejects.toThrow(
      `Athena start query failed. Reason Start failed.`,
    )
  })

  const startQueryExecutionSpy = jest.fn()
  const getQueryExecutionSpy = jest.fn()
  const getQueryResultsSpy = jest.fn()

  function mockStartQueryExecution(response: { QueryExecutionId: string }) {
    startQueryExecutionSpy.mockResolvedValue(response)
    AWSMock.mock('Athena', 'startQueryExecution', startQueryExecutionSpy)
  }
  function mockStartQueryExecutionFailed(response: string) {
    startQueryExecutionSpy.mockRejectedValue(new Error(response))
    AWSMock.mock('Athena', 'startQueryExecution', startQueryExecutionSpy)
  }

  function mockGetQueryExecution(response: GetQueryExecutionOutput) {
    getQueryExecutionSpy.mockResolvedValue(response)
    AWSMock.mock('Athena', 'getQueryExecution', getQueryExecutionSpy)
  }

  function mockGetQueryResults(results: GetQueryResultsOutput) {
    getQueryResultsSpy.mockResolvedValue(results)
    AWSMock.mock('Athena', 'getQueryResults', getQueryResultsSpy)
  }
})
