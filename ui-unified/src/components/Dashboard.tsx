import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Container, 
  Header, 
  Button, 
  Table, 
  SpaceBetween,
  Modal,
  Form,
  FormField,
  Input,
  Textarea,
  Select
} from '@cloudscape-design/components'
import { get, post } from 'aws-amplify/api'

interface Deployment {
  DeploymentId: string
  Name: string
  Description: string
  Status: string
  CreatedAt: string
  UpdatedAt: string
}

function Dashboard() {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newDeployment, setNewDeployment] = useState({
    name: '',
    description: '',
    modelProvider: 'bedrock',
    modelId: 'anthropic.claude-3-sonnet-20240229-v1:0'
  })
  const navigate = useNavigate()

  useEffect(() => {
    loadDeployments()
  }, [])

  const loadDeployments = async () => {
    try {
      setLoading(true)
      const response = await get({
        apiName: 'api',
        path: '/deployments'
      }).response
      const data = await response.body.json() as any
      setDeployments(data.deployments || [])
    } catch (error) {
      console.error('Error loading deployments:', error)
    } finally {
      setLoading(false)
    }
  }

  const createDeployment = async () => {
    try {
      const response = await post({
        apiName: 'api',
        path: '/deployments',
        options: {
          body: newDeployment
        }
      }).response
      
      await loadDeployments()
      setShowCreateModal(false)
      setNewDeployment({
        name: '',
        description: '',
        modelProvider: 'bedrock',
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0'
      })
    } catch (error) {
      console.error('Error creating deployment:', error)
    }
  }

  const modelOptions = [
    { label: 'Claude 3 Sonnet', value: 'anthropic.claude-3-sonnet-20240229-v1:0' },
    { label: 'Claude 3 Haiku', value: 'anthropic.claude-3-haiku-20240307-v1:0' },
    { label: 'Titan Text Express', value: 'amazon.titan-text-express-v1' }
  ]

  return (
    <Container
      header={
        <Header
          variant="h1"
          actions={
            <Button variant="primary" onClick={() => setShowCreateModal(true)}>
              Create Deployment
            </Button>
          }
        >
          Deployments
        </Header>
      }
    >
      <Table
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            cell: (item: Deployment) => item.Name
          },
          {
            id: 'description',
            header: 'Description',
            cell: (item: Deployment) => item.Description
          },
          {
            id: 'status',
            header: 'Status',
            cell: (item: Deployment) => item.Status
          },
          {
            id: 'created',
            header: 'Created',
            cell: (item: Deployment) => new Date(item.CreatedAt).toLocaleDateString()
          },
          {
            id: 'actions',
            header: 'Actions',
            cell: (item: Deployment) => (
              <Button
                variant="link"
                onClick={() => navigate(`/deployments/${item.DeploymentId}`)}
              >
                View Details
              </Button>
            )
          }
        ]}
        items={deployments}
        loading={loading}
        empty="No deployments found"
      />

      <Modal
        visible={showCreateModal}
        onDismiss={() => setShowCreateModal(false)}
        header="Create New Deployment"
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createDeployment}>
              Create
            </Button>
          </SpaceBetween>
        }
      >
        <Form>
          <SpaceBetween direction="vertical" size="l">
            <FormField label="Name">
              <Input
                value={newDeployment.name}
                onChange={({ detail }) => 
                  setNewDeployment({ ...newDeployment, name: detail.value })
                }
              />
            </FormField>
            <FormField label="Description">
              <Textarea
                value={newDeployment.description}
                onChange={({ detail }) => 
                  setNewDeployment({ ...newDeployment, description: detail.value })
                }
              />
            </FormField>
            <FormField label="Model">
              <Select
                selectedOption={{ label: 'Claude 3 Sonnet', value: newDeployment.modelId }}
                onChange={({ detail }) => 
                  setNewDeployment({ ...newDeployment, modelId: detail.selectedOption.value || '' })
                }
                options={modelOptions}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Modal>
    </Container>
  )
}

export default Dashboard
