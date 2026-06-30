"use client";
import Image from "next/image";
import {
  Heading,
  Box,
  Container,
  Text,
  Flex,
  Center,
  VStack,
} from "@chakra-ui/react";

export default function Home() {
  return (
    <Box
      minH="100vh"
      display="flex"
      flexDir="column"
      bgGradient="linear(to-b, #0d1117, #161b22)"
      color="white"
      bg="black"
    >
      {/* Header */}
      <Box
        as="header"
        py={6}
        px={8}
        display="flex"
        justifyContent="center"
        alignItems="center"
        borderBottom="1px"
        borderColor="#30363d"
      >
        <Flex alignItems="center" gap={2}>
          <Image
            src="/tron-logo.svg"
            alt="TronRent Logo"
            width={40}
            height={40}
            style={{ borderRadius: "50%" }}
          />
          <Heading
            as="h1"
            fontSize="2xl"
            fontWeight="bold"
            bgGradient="linear(to-r, #c23631, #f05e23)"
            bgClip="text"
          >
            TronRent
          </Heading>
        </Flex>
      </Box>

      {/* Maintenance Message */}
      <Center flex="1">
        <Container maxW="md" textAlign="center">
          <VStack gap={6}>
            <Heading
              as="h2"
              fontSize="3xl"
              bgGradient="linear(to-r, #c23631, #f05e23)"
              bgClip="text"
            >
              Under Maintenance
            </Heading>
            <Text color="gray.300" fontSize="lg">
              Our system is currently not ready for business. We&apos;re working
              hard to improve our services and will be back soon.
            </Text>
            <Box
              borderWidth="1px"
              borderColor="#30363d"
              borderRadius="md"
              p={4}
              bg="#161b22"
            >
              <Text color="gray.400">
                Thank you for your patience and understanding.
              </Text>
            </Box>
          </VStack>
        </Container>
      </Center>

      {/* Footer */}
      <Box
        as="footer"
        py={6}
        px={8}
        borderTopWidth="1px"
        borderColor="#30363d"
        bg="#0d1117"
        textAlign="center"
      >
        <Text color="gray.400">&copy; 2025 TronRent. All rights reserved.</Text>
      </Box>
    </Box>
  );
}
