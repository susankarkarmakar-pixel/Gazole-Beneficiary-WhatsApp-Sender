# 📱 Gazole Beneficiary WhatsApp Sender

A powerful Chrome extension for bulk WhatsApp messaging with intelligent batch processing, designed specifically for Gazole BDO office to send application status updates, scheme links, and important information to beneficiaries.

## ✨ Features

### 🎯 Core Features
- **Bulk Messaging**: Send messages to hundreds of beneficiaries automatically
- **Smart Batching**: Automatic phase-based sending (default: 50 messages per phase)
- **Auto-Resume**: If browser closes accidentally, resumes from where it left off
- **CSV Upload**: Easy Excel/CSV file upload with automatic column detection
- **Dynamic Variables**: Personalize messages using `{{Name}}`, `{{Status}}`, `{{Link}}`, etc.
- **Failed Numbers Export**: Automatically detect and export numbers not on WhatsApp
- **Random Delays**: 5-15 second random delays between messages to avoid spam detection
- **Phase Cooldown**: Automatic pause between batches (default: 5-10 minutes)

### 🛡️ Safety Features
- Daily limit protection (200 messages/day)
- Random delays to mimic human behavior
- Phase-based sending with cooldown periods
- Warning system for WhatsApp Web tab

### 📊 Reporting
- Real-time progress dashboard
- Sent/Failed/Pending statistics
- Export full report as CSV
- Export failed numbers separately

##  Prerequisites

- **Google Chrome** browser (version 88 or higher)
- **WhatsApp Web** account (logged in)
- **CSV/Excel file** with beneficiary data

## 🚀 Installation

### Method 1: From GitHub Codespaces

1. **Clone the repository** (if not already in Codespaces):
   ```bash
   git clone https://github.com/susankarkarmakar-pixel/Gazole-Beneficiary-WhatsApp-Sender.git
   cd Gazole-Beneficiary-WhatsApp-Sender