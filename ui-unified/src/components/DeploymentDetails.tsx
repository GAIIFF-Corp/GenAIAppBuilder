import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
  Container, 
  Header, 
  Button, 
  SpaceBetween,
  ColumnLayout,
  Box,
  StatusIndicator
} from '@cloudscape-design/components'
import { get, del } from 'aws-amplify/api'

interface Deployment {
  DeploymentId: string
  Name: string
  Description: string
  Status: string
  CreatedAt: string
  UpdatedAt: string
  modelId?: string
  modelProvider?: string
}

function DeploymentDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) {
      loadDeployment(id)
    }
  }, [id])

  const loadDeployment = async (deploymentId: string) => {
    try {
      setLoading(true)
      const response = await get({
        apiName: 'api',
        path: `/deployments/${deploymentId}`
      }).response
      const data = await response.body.json() as Deployment
      setDeployment(data)
    } catch (error) {
      console.error('Error loading deployment:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteDeployment = async () => {
    if (!id || !deployment) return
    
    try {
      await del({
        apiName: 'api',
        path: `/deployments/${id}`
      }).response
      navigate('/')
    } catch (error) {
      console.error('Error deleting deployment:', error)
    }
  }

  const getStatusType = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'success'
      case 'CREATING':
        return 'in-progress'
      case 'FAILED':
        return 'error'
      default:
        return 'pending'
    }
  }

  if (loading) {
    return <Container>Loading...</Container>
  }

  if (!deployment) {
    return <Container>Deployment not found</Container>
  }

  return (
    <Container
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => navigate('/')}>
                Back to Deployments
              </Button>
              <Button 
                variant="primary" 
                onClick={() => window.open(`http://localhost:5174?deployment=${id}`, '_blank')}
              >
                Open Chat
              </Button>
              <Button variant="normal" onClick={deleteDeployment}>
                Delete
              </Button>
            </SpaceBetween>
          }
        >
          {deployment.Name}
        </Header>
      }
    >
      <ColumnLayout columns={2} variant="text-grid">
        <div>
          <Box variant="awsui-key-label">Status</Box>
          <StatusIndicator type={getStatusType(deployment.Status)}>
            {deployment.Status}
          </StatusIndicator>
        </div>
        <div>
          <Box variant="awsui-key-label">Deployment ID</Box>
          <Box>{deployment.DeploymentId}</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">Description</Box>
          <Box>{deployment.Description || 'No description'}</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">Model</Box>
          <Box>{deployment.modelId || 'Not specified'}</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">Created</Box>
          <Box>{new Date(deployment.CreatedAt).toLocaleString()}</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">Last Updated</Box>
          <Box>{new Date(deployment.UpdatedAt).toLocaleString()}</Box>
        </div>
      </ColumnLayout>
    </Container>
  )
}

export default DeploymentDetails
