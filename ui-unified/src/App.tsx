import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { fetchAuthSession } from 'aws-amplify/auth'
import { 
  AppLayout, 
  TopNavigation, 
  Spinner, 
  Container, 
  Button,
  SideNavigation
} from '@cloudscape-design/components'
import Dashboard from './components/Dashboard'
import DeploymentDetails from './components/DeploymentDetails'
import ChatInterface from './components/ChatInterface'

interface AppProps {
  runtimeConfig: any
}

function App({ runtimeConfig }: AppProps) {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    checkAuthState()
  }, [])

  const checkAuthState = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const code = urlParams.get('code')
      
      console.log('checkAuthState - code:', code)
      
      if (code) {
        console.log('Processing OAuth callback with code:', code)
        const tokenResponse = await exchangeCodeForTokens(code)
        console.log('Token response:', tokenResponse)
        
        if (tokenResponse && tokenResponse.access_token) {
          localStorage.setItem('accessToken', tokenResponse.access_token)
          localStorage.setItem('idToken', tokenResponse.id_token || '')
          console.log('Tokens stored, setting user')
          setUser({ username: 'User' })
          // Clear URL params
          window.history.replaceState({}, document.title, window.location.pathname)
        } else {
          console.error('No tokens received')
          setUser(null)
        }
      } else {
        const accessToken = localStorage.getItem('accessToken')
        console.log('Checking existing token:', accessToken ? 'exists' : 'none')
        if (accessToken) {
          setUser({ username: 'User' })
        } else {
          setUser(null)
        }
      }
    } catch (error) {
      console.error('Authentication error:', error)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }
  
  const exchangeCodeForTokens = async (code: string) => {
    try {
      console.log('Exchanging code for tokens...')
      console.log('Domain:', runtimeConfig?.CognitoDomain)
      console.log('Client ID:', runtimeConfig?.UserPoolClientId)
      console.log('Redirect URI:', window.location.origin)
      
      const response = await fetch(`https://${runtimeConfig?.CognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: runtimeConfig?.UserPoolClientId || '',
          code: code,
          redirect_uri: runtimeConfig?.CognitoRedirectUrl || window.location.origin
        })
      })
      
      console.log('Token response status:', response.status)
      const result = await response.json()
      console.log('Token response body:', result)
      
      if (!response.ok) {
        console.error('Token exchange failed:', result)
        return null
      }
      
      return result
    } catch (error) {
      console.error('Token exchange error:', error)
      return null
    }
  }

  const handleSignIn = () => {
    const cognitoDomain = runtimeConfig?.CognitoDomain
    const clientId = runtimeConfig?.UserPoolClientId
    const redirectUri = encodeURIComponent(runtimeConfig?.CognitoRedirectUrl || window.location.origin)
    
    if (cognitoDomain && clientId) {
      const hostedUIUrl = `https://${cognitoDomain}/login?client_id=${clientId}&response_type=code&scope=openid+email+profile&redirect_uri=${redirectUri}`
      console.log('Sign-in URL:', hostedUIUrl)
      window.location.href = hostedUIUrl
    }
  }

  const handleSignOut = () => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('idToken')
    setUser(null)
  }

  const navigationItems = [
    {
      type: 'section',
      text: 'Management',
      items: [
        {
          type: 'link',
          text: 'Dashboard',
          href: '/'
        }
      ]
    },
    {
      type: 'section', 
      text: 'AI Assistant',
      items: [
        {
          type: 'link',
          text: 'Chat Interface',
          href: '/chat'
        }
      ]
    }
  ]

  if (!runtimeConfig) {
    return (
      <Container>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>Configuration Error</h2>
          <p>Unable to load runtime configuration. Please check your deployment.</p>
        </div>
      </Container>
    )
  }

  if (loading) {
    return (
      <Container>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <Spinner size="large" />
          <p>Loading...</p>
        </div>
      </Container>
    )
  }

  if (!user) {
    return (
      <Container>
        <div style={{ padding: '40px', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
          <h1>Generative AI Application Builder</h1>
          <p style={{ marginBottom: '30px', fontSize: '16px', color: '#666' }}>
            Manage your AI deployments and chat with advanced AI models powered by AWS Bedrock. 
            Sign in to get started or create a new account.
          </p>
          <Button variant="primary" size="large" onClick={handleSignIn}>
            Sign In / Register
          </Button>
          <div style={{ marginTop: '20px', fontSize: '14px', color: '#888' }}>
            <p>New users can register directly through the sign-in process</p>
          </div>
        </div>
      </Container>
    )
  }

  return (
    <div>
      <TopNavigation
        identity={{
          href: '/',
          title: 'Generative AI Application Builder'
        }}
        utilities={[
          {
            type: 'button',
            text: `Welcome, ${user.username}`,
            variant: 'link'
          },
          {
            type: 'button',
            text: 'Sign out',
            onClick: handleSignOut
          }
        ]}
      />
      <AppLayout
        navigation={
          <SideNavigation
            activeHref={location.pathname}
            header={{ text: 'Navigation', href: '/' }}
            items={navigationItems}
            onFollow={(event) => {
              if (!event.detail.external) {
                event.preventDefault()
                navigate(event.detail.href)
              }
            }}
          />
        }
        content={
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/deployments/:id" element={<DeploymentDetails />} />
            <Route path="/chat" element={<ChatInterface />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        }
      />
    </div>
  )
}

export default App
