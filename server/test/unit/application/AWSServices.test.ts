describe('AWSServices', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  afterEach(() => {
    jest.resetModules()
  })

  it('should return empty if no service in config file', () => {
    jest.doMock('@application/Config.json', () => {
      return {
        CURRENT_SERVICES: [],
      }
    })

    const AWSServices = require('@application/AWSServices').default
    const services = AWSServices()
    expect(services).toHaveLength(0)
  })

  it('should throw error if unknown service', () => {
    jest.doMock('@application/Config.json', () => {
      return {
        CURRENT_SERVICES: [
          {
            key: 'duck',
          },
        ],
      }
    })

    const AWSServices = require('@application/AWSServices').default
    expect(AWSServices).toThrowError('Unsupported service: duck')
  })

  it('should return instances from registered services in configuration file', () => {
    const EBS = require('@services/EBS').default
    expectService('ebs').toBeInstanceOf(EBS)
  })

  it('should return s3 instance', () => {
    const S3 = require('@services/S3').default
    expectService('s3').toBeInstanceOf(S3)
  })

  it('should return ec2 instance', () => {
    const EC2 = require('@services/EC2').default
    expectService('ec2').toBeInstanceOf(EC2)
  })

  it('should return elasticache instance', () => {
    const ElastiCache = require('@services/ElastiCache').default
    expectService('elasticache').toBeInstanceOf(ElastiCache)
  })

  it('should return rds instance', () => {
    const RDS = require('@services/RDS').default
    expectService('rds').toBeInstanceOf(RDS)
  })

  it('should return lambda instance', () => {
    const Lambda = require('@services/Lambda').default
    expectService('lambda').toBeInstanceOf(Lambda)
  })
})

function expectService(key: string) {
  jest.doMock('@application/Config.json', () => {
    return {
      CURRENT_SERVICES: [
        {
          key: key,
        },
      ],
    }
  })

  const AWSServices = require('@application/AWSServices').default
  const services = AWSServices()
  return expect(services[0])
}