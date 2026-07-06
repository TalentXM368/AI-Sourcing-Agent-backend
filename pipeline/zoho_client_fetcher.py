"""Zoho CRM Client Data Fetcher.

This module handles fetching raw client data from Zoho CRM APIs.
Provides authentication, data retrieval, and error handling for Zoho integration.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional
import urllib.error
import urllib.request


class ZohoCRMFetcher:
    """Fetches raw client data from Zoho CRM APIs.
    
    Supports:
    - OAuth2 authentication
    - Client profile data retrieval
    - Bulk data fetching
    - Error handling and retry logic
    """
    
    ZOHO_API_BASE_URL = "https://www.zohoapis.com/crm/v2"
    
    def __init__(
        self,
        zoho_api_token: Optional[str] = None,
        zoho_org_id: Optional[str] = None,
        timeout: int = 30,
    ) -> None:
        """Initialize Zoho CRM fetcher.
        
        Args:
            zoho_api_token: Zoho API token (Bearer token)
                           Defaults to ZOHO_API_TOKEN environment variable
            zoho_org_id: Zoho Organization ID
                        Defaults to ZOHO_ORG_ID environment variable
            timeout: Request timeout in seconds
        """
        self.zoho_api_token = zoho_api_token or os.getenv("ZOHO_API_TOKEN", "")
        self.zoho_org_id = zoho_org_id or os.getenv("ZOHO_ORG_ID", "")
        self.timeout = timeout
        self.logger = logging.getLogger(__name__)
        
        if not self.zoho_api_token:
            self.logger.warning("ZOHO_API_TOKEN not configured - Zoho CRM fetching will be disabled")
    
    def is_configured(self) -> bool:
        """Check if Zoho API credentials are configured."""
        return bool(self.zoho_api_token and self.zoho_org_id)
    
    def fetch_client_profile(self, client_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a single client profile from Zoho CRM.
        
        Args:
            client_id: Zoho CRM client/account ID
            
        Returns:
            Raw client data dict or None if fetch fails
        """
        if not self.is_configured():
            self.logger.debug("Zoho credentials not configured, skipping fetch")
            return None
        
        url = f"{self.ZOHO_API_BASE_URL}/Accounts/{client_id}"
        
        try:
            response = self._make_request(url, method="GET")
            if response and "data" in response:
                return response["data"]
            return None
        except Exception as e:
            self.logger.error(f"Failed to fetch client profile {client_id}: {e}")
            return None
    
    def fetch_all_clients(self, page: int = 1, per_page: int = 200) -> Optional[list]:
        """Fetch all clients from Zoho CRM with pagination.
        
        Args:
            page: Page number (1-indexed)
            per_page: Records per page (max 200)
            
        Returns:
            List of client data dicts or None if fetch fails
        """
        if not self.is_configured():
            self.logger.debug("Zoho credentials not configured, skipping fetch")
            return None
        
        url = f"{self.ZOHO_API_BASE_URL}/Accounts"
        params = f"?page={page}&per_page={per_page}"
        
        try:
            response = self._make_request(url + params, method="GET")
            if response and "data" in response:
                return response["data"]
            return None
        except Exception as e:
            self.logger.error(f"Failed to fetch all clients: {e}")
            return None
    
    def fetch_client_custom_fields(self, client_id: str, custom_fields: list) -> Optional[Dict[str, Any]]:
        """Fetch specific custom fields for a client.
        
        Args:
            client_id: Zoho CRM client/account ID
            custom_fields: List of custom field API names
            
        Returns:
            Dict mapping field names to values or None
        """
        profile = self.fetch_client_profile(client_id)
        if not profile:
            return None
        
        result = {}
        for field in custom_fields:
            result[field] = profile.get(field)
        return result
    
    def search_clients_by_criteria(self, criteria: Dict[str, Any]) -> Optional[list]:
        """Search for clients matching given criteria.
        
        Args:
            criteria: Dict with search parameters
                     Example: {"industry": "FinTech", "company_size": "Startup"}
            
        Returns:
            List of matching client data or None
        """
        if not self.is_configured():
            self.logger.debug("Zoho credentials not configured, skipping search")
            return None
        
        url = f"{self.ZOHO_API_BASE_URL}/Accounts/search"
        
        # Build search query
        criteria_parts = []
        for key, value in criteria.items():
            criteria_parts.append(f"{key}:equals:{value}")
        
        search_query = " and ".join(criteria_parts)
        params = f"?criteria=({search_query})"
        
        try:
            response = self._make_request(url + params, method="GET")
            if response and "data" in response:
                return response["data"]
            return None
        except Exception as e:
            self.logger.error(f"Failed to search clients with criteria {criteria}: {e}")
            return None
    
    def fetch_client_interactions(self, client_id: str) -> Optional[list]:
        """Fetch recent interactions/interactions for a client.
        
        Args:
            client_id: Zoho CRM client/account ID
            
        Returns:
            List of interaction records or None
        """
        if not self.is_configured():
            return None
        
        url = f"{self.ZOHO_API_BASE_URL}/Accounts/{client_id}/Activities"
        
        try:
            response = self._make_request(url, method="GET")
            if response and "data" in response:
                return response["data"]
            return None
        except Exception as e:
            self.logger.error(f"Failed to fetch interactions for client {client_id}: {e}")
            return None
    
    def _make_request(
        self,
        url: str,
        method: str = "GET",
        data: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Make HTTP request to Zoho API.
        
        Args:
            url: Full API endpoint URL
            method: HTTP method (GET, POST, etc.)
            data: Request body data (optional)
            
        Returns:
            Parsed JSON response or None on error
        """
        headers = {
            "Authorization": f"Bearer {self.zoho_api_token}",
            "Content-Type": "application/json",
        }
        
        if self.zoho_org_id:
            headers["X-CRM-ORG"] = self.zoho_org_id
        
        try:
            body = None
            if data:
                body = json.dumps(data).encode("utf-8")
            
            request = urllib.request.Request(
                url,
                data=body,
                headers=headers,
                method=method,
            )
            
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                response_data = response.read().decode("utf-8")
                return json.loads(response_data)
        
        except urllib.error.HTTPError as e:
            self.logger.error(f"HTTP error {e.code}: {e.reason}")
            return None
        except urllib.error.URLError as e:
            self.logger.error(f"URL error: {e.reason}")
            return None
        except json.JSONDecodeError as e:
            self.logger.error(f"JSON decode error: {e}")
            return None
        except TimeoutError as e:
            self.logger.error(f"Request timeout: {e}")
            return None
        except Exception as e:
            self.logger.error(f"Unexpected error during Zoho API request: {e}")
            return None


# Singleton instance for convenient module-level access
_fetcher_instance: Optional[ZohoCRMFetcher] = None


def get_fetcher(
    zoho_api_token: Optional[str] = None,
    zoho_org_id: Optional[str] = None,
) -> ZohoCRMFetcher:
    """Get or create singleton Zoho fetcher instance.
    
    Args:
        zoho_api_token: Zoho API token (optional)
        zoho_org_id: Zoho Org ID (optional)
        
    Returns:
        ZohoCRMFetcher instance
    """
    global _fetcher_instance
    
    if _fetcher_instance is None:
        _fetcher_instance = ZohoCRMFetcher(
            zoho_api_token=zoho_api_token,
            zoho_org_id=zoho_org_id,
        )
    
    return _fetcher_instance
