// utils/csvParser.js - Robust CSV Parser for Customer Import

/**
 * Clean and validate phone number
 */
function cleanPhone(phone) {
  if (!phone || phone === 'N/A' || phone === '') return null;
  
  // Remove all non-digit characters
  const cleaned = phone.toString().replace(/\D/g, '');
  
  // Validate length
  if (cleaned.length === 10) {
    return '+1' + cleaned;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return '+' + cleaned;
  } else if (cleaned.length > 10 && cleaned.length <= 15) {
    // International numbers
    return '+' + cleaned;
  }
  
  return null;
}

/**
 * Detect CSV delimiter
 */
function detectDelimiter(line) {
  const delimiters = [',', '\t', ';', '|'];
  let maxCount = 0;
  let detected = ',';
  
  delimiters.forEach(delim => {
    const count = (line.match(new RegExp('\\' + delim, 'g')) || []).length;
    if (count > maxCount) {
      maxCount = count;
      detected = delim;
    }
  });
  
  return detected;
}

/**
 * Auto-detect column types by analyzing data patterns
 */
function autoDetectColumns(sampleLines, delimiter) {
  if (!sampleLines || sampleLines.length === 0) {
    return ['phone', 'email', 'name', 'location'];
  }

  const columnCount = sampleLines[0].split(delimiter).length;
  const columns = new Array(columnCount).fill(null);

  // Analyze each column
  for (let colIdx = 0; colIdx < columnCount; colIdx++) {
    const values = sampleLines.map(line => {
      const cells = line.split(delimiter);
      return cells[colIdx] ? cells[colIdx].trim().replace(/^["']|["']$/g, '') : '';
    }).filter(Boolean);

    if (values.length === 0) {
      columns[colIdx] = `field${colIdx}`;
      continue;
    }

    // Check patterns
    const phonePattern = values.filter(v => /^\+?\d{10,15}$/.test(v.replace(/[\s\-()]/g, '')));
    const emailPattern = values.filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
    const datePattern = values.filter(v => /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v));
    const yesNoPattern = values.filter(v => /^(yes|no|true|false)$/i.test(v));

    // Assign column type based on highest match
    if (phonePattern.length >= values.length * 0.7) {
      columns[colIdx] = 'phone';
    } else if (emailPattern.length >= values.length * 0.7) {
      columns[colIdx] = 'email';
    } else if (datePattern.length >= values.length * 0.5) {
      if (columns.includes('lastcheckin')) {
        columns[colIdx] = 'signupdate';
      } else {
        columns[colIdx] = 'lastcheckin';
      }
    } else if (yesNoPattern.length >= values.length * 0.7) {
      columns[colIdx] = 'subscribed';
    } else if (colIdx === 0 && !columns[0]) {
      // If first column not detected, assume it's phone
      columns[colIdx] = 'phone';
    } else if (!columns.includes('name') && colIdx < 3) {
      columns[colIdx] = 'name';
    } else if (!columns.includes('location')) {
      columns[colIdx] = 'location';
    } else {
      columns[colIdx] = `field${colIdx}`;
    }
  }

  // Ensure we have at least one phone column
  if (!columns.includes('phone')) {
    columns[0] = 'phone'; // Assume first column is phone
  }

  return columns;
}

/**
 * Find phone column index in headers
 */
function findPhoneColumnIndex(headers) {
  // Look for phone-related headers
  const phoneIdx = headers.findIndex(h => 
    h.includes('phone') || h.includes('mobile') || h.includes('tel')
  );
  
  if (phoneIdx !== -1) return phoneIdx;
  
  // Default to first column
  return 0;
}

/**
 * Parse CSV text into customer objects
 * Handles both labeled (with headers) and unlabeled (no headers) CSV files
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }

  const delimiter = detectDelimiter(lines[0]);
  console.log(`📊 Detected delimiter: "${delimiter}"`);
  
  // Parse first two lines to detect if headers exist
  const firstLine = lines[0].split(delimiter).map(cell => 
    cell.trim().replace(/^["']|["']$/g, '')
  );
  
  // Check if first line is a header
  const isHeader = firstLine.some(cell => 
    /^(phone|email|name|location|check.*in|sign.*up|subscribed|rewards|notes)/i.test(cell)
  ) || firstLine.every(cell => isNaN(cell) && !/^\+?\d+$/.test(cell));

  let headers = [];
  let dataStartIndex = 0;

  if (isHeader) {
    // Has headers - normalize them
    headers = firstLine.map(h => 
      h.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/checkin/gi, 'checkin')
        .replace(/signup/gi, 'signup')
    );
    dataStartIndex = 1;
    console.log(`✅ Headers detected: ${headers.join(', ')}`);
  } else {
    // No headers - detect columns by analyzing first few rows
    const sampleSize = Math.min(10, lines.length);
    headers = autoDetectColumns(lines.slice(0, sampleSize), delimiter);
    dataStartIndex = 0;
    console.log(`🔍 Auto-detected columns: ${headers.join(', ')}`);
  }

  // Find phone column index
  const phoneIndex = findPhoneColumnIndex(headers);
  console.log(`📞 Phone column at index: ${phoneIndex}`);

  // Parse data rows
  const customers = [];
  const errors = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(delimiter).map(cell => 
      cell.trim().replace(/^["']|["']$/g, '')
    );
    
    try {
      const rawPhone = values[phoneIndex];
      const phone = cleanPhone(rawPhone);
      
      if (!phone) {
        errors.push({
          row: i + 1,
          phone: rawPhone || 'N/A',
          reason: 'Missing or invalid phone number'
        });
        continue;
      }

      const customer = { phone };

      // Map other fields dynamically
      headers.forEach((header, idx) => {
        if (idx === phoneIndex || !values[idx]) return;
        
        const value = values[idx].trim();
        
        if (header.includes('email')) {
          customer.email = value;
        } else if (header.includes('name')) {
          customer.name = value;
        } else if (header.includes('location')) {
          customer.location = value;
        } else if (header.includes('notes')) {
          customer.notes = value;
        } else if (header.includes('subscribed')) {
          customer.subscribedStatus = /yes|true|1/i.test(value) ? 'Yes' : 'No';
        } else if (header.includes('lastcheckin') || header.includes('last_check_in')) {
          customer['Last Check-In'] = value;
        } else if (header.includes('signup') || header.includes('sign_up_date')) {
          customer['Sign Up Date'] = value;
        } else if (header.includes('totalcheckin') || header.includes('total_check_ins')) {
          customer['Total Check-Ins'] = value;
        } else if (header.includes('currentcheckin') || header.includes('current_check_ins')) {
          customer['Current Check-Ins'] = value;
        } else if (header.includes('rewards')) {
          customer.Rewards = value;
        }
      });

      customers.push(customer);
    } catch (error) {
      errors.push({
        row: i + 1,
        phone: values[phoneIndex] || 'N/A',
        reason: error.message
      });
    }
  }

  console.log(`✅ Parsed ${customers.length} valid customers`);
  console.log(`⚠️ Found ${errors.length} invalid rows`);

  return { customers, errors };
}

module.exports = {
  parseCSV,
  cleanPhone,
  detectDelimiter,
  autoDetectColumns,
  findPhoneColumnIndex
};