import React, { useState, useRef, useEffect } from 'react'
import { 
  Container, 
  Header, 
  Button, 
  Input,
  SpaceBetween,
  Box,
  Spinner
} from '@cloudscape-design/components'
import { post } from 'aws-amplify/api'
import ReactMarkdown from 'react-markdown'
import { v4 as uuidv4 } from 'uuid'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string>(() => uuidv4())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async () => {
    if (!inputValue.trim() || loading) return

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setLoading(true)

    try {
      const response = await post({
        apiName: 'api',
        path: '/chat',
        options: {
          body: {
            message: inputValue,
            conversationId: conversationId
          }
        }
      }).response

      const data = await response.body.json() as any

      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: data.response,
        timestamp: data.timestamp
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your message. Please try again.',
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  const clearChat = () => {
    setMessages([])
    setConversationId(uuidv4())
  }

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  return (
    <Container
      header={
        <Header
          variant="h1"
          actions={
            <Button onClick={clearChat}>
              Clear Chat
            </Button>
          }
        >
          AI Chat Assistant
        </Header>
      }
    >
      <SpaceBetween direction="vertical" size="l">
        {/* Messages Area */}
        <div style={{ 
          height: '500px', 
          overflowY: 'auto', 
          border: '1px solid #e1e4e8', 
          borderRadius: '8px',
          padding: '16px',
          backgroundColor: '#fafbfc'
        }}>
          {messages.length === 0 ? (
            <Box textAlign="center" color="text-body-secondary">
              <p>Welcome! Start a conversation by typing a message below.</p>
            </Box>
          ) : (
            <SpaceBetween direction="vertical" size="m">
              {messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    display: 'flex',
                    justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start'
                  }}
                >
                  <div
                    style={{
                      maxWidth: '70%',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      backgroundColor: message.role === 'user' ? '#0073bb' : '#ffffff',
                      color: message.role === 'user' ? '#ffffff' : '#000000',
                      border: message.role === 'assistant' ? '1px solid #e1e4e8' : 'none'
                    }}
                  >
                    {message.role === 'assistant' ? (
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    ) : (
                      <p style={{ margin: 0 }}>{message.content}</p>
                    )}
                    <div style={{ 
                      fontSize: '12px', 
                      opacity: 0.7, 
                      marginTop: '4px' 
                    }}>
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #e1e4e8'
                  }}>
                    <Spinner size="normal" />
                    <span style={{ marginLeft: '8px' }}>Thinking...</span>
                  </div>
                </div>
              )}
            </SpaceBetween>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input
              value={inputValue}
              onChange={({ detail }) => setInputValue(detail.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type your message here..."
              disabled={loading}
            />
          </div>
          <Button
            variant="primary"
            onClick={sendMessage}
            disabled={!inputValue.trim() || loading}
          >
            Send
          </Button>
        </div>
      </SpaceBetween>
    </Container>
  )
}

export default ChatInterface
